-- 017_backup_snapshot_coverage.sql
-- Additive + reversible (017_backup_snapshot_coverage_rollback.sql). #428.
--
-- WHAT WAS WRONG: public.backup_snapshot() hardcoded 8 tables, so the nightly
-- `daily-db-snapshot` cron (via public.run_backup_snapshot()) never exported
-- coach_log, anchors, exercises, exercise_media, bp_readings, lab_results or
-- injuries. Neither function, nor the backup_snapshots table, was in any
-- migration (liveOnly 20260622173542 backup_snapshots_infra), so no review
-- had ever seen that list.
--
-- WHAT THIS DOES:
--   1. Captures public.backup_snapshots exactly as live (id bigint identity
--      PK backup_snapshots_pkey, created_at timestamptz default now(), payload
--      jsonb; RLS on, not forced, no policies; only postgres and service_role
--      hold grants). Verified no-op on production; on a fresh database it
--      creates the table. The closing self-test guards its shape, because
--      `create table if not exists` silently skips a drifted table.
--   2. Replaces backup_snapshot() with a catalogue-driven version: every base
--      table in `public` (pg_class relkind 'r'/'p', not a partition), minus a
--      constant exclusion array declared in the function body. A table added
--      later is in tomorrow's snapshot with no edit here. A table that must NOT
--      be exported (credentials, secrets) adds itself to that array in its own
--      migration — see .claude/skills/supabase-patterns.md § Migrations.
--   3. Re-states run_backup_snapshot() with an empty search_path and fully
--      qualified names. Behaviour unchanged: insert one row, keep the latest 30
--      by created_at.
--
-- PAYLOAD v2 (the shape changes; v1 rows already stored stay as they are):
--   { "schema_version": 2, "exported_at": <now()>, "excluded": [...],
--     "counts": { <table>: <bigint> }, "tables": { <table>: [<rows>] } }
-- v1 put each table at the top level next to exported_at/counts. A restore
-- reads payload->'schema_version' first: absent means v1.
--
-- WHY STABLE. From the Postgres docs (xfunc-volatility.html, via Context7
-- /websites/postgresql): "STABLE and IMMUTABLE functions use a snapshot
-- established as of the start of the calling query, whereas VOLATILE functions
-- obtain a fresh snapshot at the start of each query they execute", and
-- "PostgreSQL will execute all commands of a STABLE function using the
-- snapshot established for the calling query". The live VOLATILE version ran
-- 16 separate queries, each on its own snapshot, so a write landing mid-export
-- could make counts disagree with rows, or a child row appear without its
-- parent. STABLE makes the whole export one consistent picture. It also means
-- the function cannot modify the database — it only reads.
--
-- WHY CREATE OR REPLACE, AND WHY LANGUAGE/VOLATILITY MAY CHANGE. From
-- sql-createfunction.html (Context7 /websites/postgresql): CREATE OR REPLACE
-- "will not let you change the return type" (unchanged here: jsonb, void),
-- "the ownership and permissions of the function do not change", and "all
-- other function properties are assigned the values specified or implied in
-- the command". So the ACL survives; the revoke/grant below is belt and braces
-- per the 011/014 SECURITY DEFINER rule.
--
-- search_path = '' on both: nothing resolves through `public` implicitly.
-- User objects are written public.<name>; built-ins resolve from pg_catalog,
-- which is always searched first when it is not named in search_path.
--
-- SECURITY DEFINER is kept: the function runs as its owner, postgres, which
-- owns every table in `public` and is not subject to their (non-forced) RLS.
-- That is what lets the cron export every user's rows.
--
-- SELF-TEST (closing DO block, `raise exception` so plpgsql.check_asserts
-- cannot switch it off). It calls backup_snapshot() — read-only, writes no
-- backup_snapshots row — inside ONE statement that also takes a fresh
-- count(*) of every table, so both sides share one snapshot and a concurrent
-- app write cannot fake a mismatch. apply_migration runs in a transaction, so
-- any raise rolls the whole migration back.
--
-- NOT HERE: the cron job (liveOnly 20260622173551 schedule_daily_backup) still
-- has no file. The schedule itself does not change.
--
-- APPLY: Scott approves; Supabase MCP apply_migration with name exactly
-- `017_backup_snapshot_coverage`; then its supabase/migrations/manifest.json
-- entry flips to `applied` with the live version, and the live-migrations
-- fixture is refreshed from list_migrations in the same PR. Read back: the
-- next cron row (or a manual run_backup_snapshot(), Scott's call) has a key
-- and a matching count for every table, and get_advisors shows nothing new.

do $$
begin
  if current_user <> 'postgres' then
    raise exception '017 must run as postgres (owner of both functions and the table): current_user=%', current_user;
  end if;
end $$;

create table if not exists public.backup_snapshots (
  id         bigint generated always as identity,
  created_at timestamptz not null default now(),
  payload    jsonb not null,
  constraint backup_snapshots_pkey primary key (id)
);

alter table public.backup_snapshots enable row level security;

revoke all on table public.backup_snapshots from anon, authenticated;

create or replace function public.backup_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  -- Tables never exported. backup_snapshots would nest every earlier snapshot.
  -- Coverage relies on the owner bypassing RLS: never FORCE RLS on a public
  -- table (017's self-test refuses it), or that table exports only some rows.
  v_excluded constant text[] := array['backup_snapshots'];
  v_rel      text;
  v_count    bigint;
  v_rows     jsonb;
  v_counts   jsonb := '{}'::jsonb;
  v_tables   jsonb := '{}'::jsonb;
begin
  for v_rel in
    select c.relname::text
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relispartition
       and c.relname::text <> all (v_excluded)
     order by c.relname
  loop
    execute format(
      'select count(*), coalesce(jsonb_agg(t), ''[]''::jsonb) from public.%I t',
      v_rel
    ) into v_count, v_rows;
    v_counts := v_counts || jsonb_build_object(v_rel, v_count);
    v_tables := v_tables || jsonb_build_object(v_rel, v_rows);
  end loop;

  return jsonb_build_object(
    'schema_version', 2,
    'exported_at', now(),
    'excluded', to_jsonb(v_excluded),
    'counts', v_counts,
    'tables', v_tables
  );
end;
$function$;

create or replace function public.run_backup_snapshot()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  insert into public.backup_snapshots(payload) values (public.backup_snapshot());
  delete from public.backup_snapshots
   where id not in (select id from public.backup_snapshots order by created_at desc limit 30);
end;
$function$;

revoke all on function public.backup_snapshot() from public, anon, authenticated;
revoke all on function public.run_backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;
grant execute on function public.run_backup_snapshot() to service_role;

-- Self-test. Every check raises; nothing here writes.
do $$
declare
  v_excluded constant text[] := array['backup_snapshots'];
  v_expected text[];
  v_tables   text[];
  v_counts   text[];
  v_fresh_sql text;
  v_snap     jsonb;
  v_fresh    jsonb;
  v_rel      text;
  v_fn       text;
begin
  -- Table shape: a drifted live table would have been skipped by IF NOT EXISTS.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'backup_snapshots') <> 3
     or not exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = 'public.backup_snapshots'::regclass
                      and a.attname = 'id' and a.attidentity = 'a'
                      and a.atttypid = 'bigint'::regtype)
     or not exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = 'public.backup_snapshots'::regclass
                      and a.attname = 'payload' and a.attnotnull
                      and a.atttypid = 'jsonb'::regtype)
     or not exists (select 1 from pg_catalog.pg_attribute a
                    join pg_catalog.pg_attrdef d
                      on d.adrelid = a.attrelid and d.adnum = a.attnum
                    where a.attrelid = 'public.backup_snapshots'::regclass
                      and a.attname = 'created_at' and a.attnotnull
                      and a.atttypid = 'timestamptz'::regtype
                      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'now()')
     or not (select c.relrowsecurity from pg_catalog.pg_class c
             where c.oid = 'public.backup_snapshots'::regclass) then
    raise exception '017: live backup_snapshots has drifted from the captured shape (3 columns, id bigint identity always, created_at timestamptz not null default now(), payload jsonb not null, RLS on)';
  end if;

  -- FORCE RLS would bind the owner too: the export and the count(*) below
  -- would both see 0 rows and agree, so the coverage check could not catch it.
  if exists (select 1 from pg_catalog.pg_class c
             where c.relnamespace = 'public'::regnamespace
               and c.relkind in ('r', 'p')
               and c.relforcerowsecurity) then
    raise exception '017: a public table has FORCE ROW LEVEL SECURITY; the snapshot would silently export only the rows its policies allow postgres to see';
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname::text collate "C"), '{}')
    into v_expected
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and c.relname::text <> all (v_excluded);

  if cardinality(v_expected) = 0 then
    raise exception '017: no base tables found in public — the catalogue query is wrong';
  end if;

  -- One statement: the STABLE function and the fresh counts share a snapshot.
  -- `||` rather than one jsonb_build_object, which caps at 100 arguments.
  select string_agg(format('jsonb_build_object(%L, (select count(*) from public.%I))', r, r), ' || ')
    into v_fresh_sql
    from unnest(v_expected) r;
  execute format('select public.backup_snapshot(), %s', v_fresh_sql) into v_snap, v_fresh;

  if v_snap->'schema_version' is distinct from '2'::jsonb then
    raise exception '017: schema_version is %, want 2', v_snap->'schema_version';
  end if;
  if v_snap->'excluded' is distinct from to_jsonb(v_excluded) then
    raise exception '017: excluded is %, want %', v_snap->'excluded', to_jsonb(v_excluded);
  end if;
  if not v_snap ? 'exported_at' then
    raise exception '017: payload has no exported_at';
  end if;

  select coalesce(array_agg(k order by k collate "C"), '{}') into v_tables
    from jsonb_object_keys(v_snap->'tables') k;
  select coalesce(array_agg(k order by k collate "C"), '{}') into v_counts
    from jsonb_object_keys(v_snap->'counts') k;

  if v_tables is distinct from v_expected then
    raise exception '017: tables keys % do not match catalogue base tables minus exclusions %', v_tables, v_expected;
  end if;
  if v_counts is distinct from v_expected then
    raise exception '017: counts keys % do not match catalogue base tables minus exclusions %', v_counts, v_expected;
  end if;

  foreach v_rel in array v_expected loop
    if (v_snap->'counts'->>v_rel)::bigint is distinct from (v_fresh->>v_rel)::bigint
       or jsonb_array_length(v_snap->'tables'->v_rel) is distinct from (v_fresh->>v_rel)::bigint then
      raise exception '017: %: counts=% rows=% but count(*)=%',
        v_rel, v_snap->'counts'->>v_rel, jsonb_array_length(v_snap->'tables'->v_rel), v_fresh->>v_rel;
    end if;
  end loop;

  foreach v_fn in array array['public.backup_snapshot()', 'public.run_backup_snapshot()'] loop
    if has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '017: % has wrong EXECUTE (want public/anon/authenticated false, service_role true)', v_fn;
    end if;
    if not exists (select 1 from pg_catalog.pg_proc p
                   where p.oid = v_fn::regprocedure
                     and p.prosecdef
                     and p.proconfig @> array['search_path=""']) then
      raise exception '017: % is not SECURITY DEFINER with search_path=""', v_fn;
    end if;
  end loop;

  if (select p.provolatile from pg_catalog.pg_proc p
      where p.oid = 'public.backup_snapshot()'::regprocedure) <> 's' then
    raise exception '017: backup_snapshot() is not STABLE';
  end if;

  raise notice '017: snapshot covers % tables (%), excluded %, counts match count(*); grants and search_path ok',
    cardinality(v_expected), array_to_string(v_expected, ', '), v_excluded;
end $$;
