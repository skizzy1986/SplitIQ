-- 018_strava_backup_exclusion.sql
-- Additive + reversible (018_strava_backup_exclusion_rollback.sql). #629.
--
-- WHAT WAS WRONG: 012 created four strava_* tables, two of them holding OAuth
-- credentials, and relied on FORCE ROW LEVEL SECURITY to keep them private.
-- That never kept them out of the nightly backup: backup_snapshot() (017) is
-- SECURITY DEFINER owned by postgres, postgres has rolbypassrls = true, and
-- FORCE does not bind a BYPASSRLS role. 017's catalogue-driven export takes
-- every base table in `public`, so from the first cron run after 012 the
-- access and refresh tokens would have been copied into backup_snapshots and
-- kept for 30 days. (012 has since dropped FORCE; this is the real control.)
--
-- WHAT THIS DOES:
--   1. Refuses to run before 012 (checks for public.strava_session_links).
--   2. Re-creates backup_snapshot() with the body 017 wrote, changing ONE
--      thing: v_excluded gains strava_oauth_state, strava_session_links,
--      strava_sync_state and strava_tokens. sessions stays in the snapshot,
--      whole, Strava-imported rows included (owner decision on #628: purged
--      data lingers in snapshots until they roll off, accepted).
--      The credentials need no explanation. The other two are excluded
--      because they hold nothing a restore needs that sessions does not
--      already carry, and because the sync cursor and provenance are Strava
--      state that slice 2 (#630) must be able to delete outright.
--      This is the rule 017 set (.claude/skills/supabase-patterns.md §
--      Migrations): a table that must not be exported adds itself to the
--      array in a migration. web/scripts/__tests__/strava-credential-backup
--      .test.mjs fails CI if a later migration redefines backup_snapshot()
--      and drops any of the four.
--   3. Creates public.sessions_no_strava, a security_invoker view for agent
--      sessions (slice 3, #631): Strava API Policy §5.3 forbids reading Strava
--      data into an AI context window. It hides every row the importer
--      inserted, every linked row with no provenance (fail closed), and on an
--      adopted row shows the athlete's own avg_watts / avg_hr in place of
--      Strava's. strava_activity_id is not in it.
--
-- CREATE OR REPLACE keeps the function's owner and ACL (sql-createfunction.html,
-- via Context7 /websites/postgresql, as quoted in 017); the revoke/grant below
-- restates 017's exactly as belt and braces.
--
-- THE VIEW IS NOT EXPORTED. backup_snapshot() walks pg_class with
-- relkind IN ('r', 'p') — ordinary and partitioned tables only. A view is
-- relkind 'v', so sessions_no_strava never becomes a snapshot key (the
-- self-test below checks it).
--
-- security_invoker: since PostgreSQL 15 ("Allow table accesses done by a view
-- to optionally be controlled by privileges of the view's caller",
-- release-15.html; sql-createview.html, via Context7 /websites/postgresql).
-- Production runs 17.6 (`select version()`, 2026-11-16). With it set, the
-- invoker's own privileges and RLS policies apply to sessions and
-- strava_session_links, so the view cannot widen anyone's access; without it
-- the view would read both tables as its owner, postgres.
--
-- WHAT THAT DOES AND DOES NOT BUY. The view's real readers are agent sessions,
-- and the roles they reach the database through — the MCP connector roles,
-- postgres and service_role — bypass RLS, and can read sessions directly. So
-- this view is a CONVENTION for agent sessions (the hook and rules in #631
-- point them at it), not an enforcement boundary: nothing here stops a
-- privileged role selecting from sessions. anon and authenticated have no
-- access to the view at all (revoked below), so it is not a browser surface
-- either.
--
-- APPLY: Scott approves; Supabase MCP apply_migration with name exactly
-- `018_strava_backup_exclusion`, in the same sitting as 011 and 012 and before
-- any OAuth grant; then its manifest entry flips to `applied` with the live
-- version. Read back: pg_get_functiondef(backup_snapshot) shows the five-name
-- array, and get_advisors shows nothing new.

do $$
begin
  if current_user <> 'postgres' then
    raise exception '018 must run as postgres (owner of backup_snapshot()): current_user=%', current_user;
  end if;
  if to_regclass('public.strava_session_links') is null then
    raise exception '018 needs 012_strava_integration applied first: public.strava_session_links does not exist';
  end if;
end $$;

create or replace function public.backup_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  -- Tables never exported. backup_snapshots would nest every earlier snapshot.
  -- The strava_* tables hold OAuth credentials and Strava sync state (018).
  -- Coverage relies on the owner bypassing RLS: never FORCE RLS on a public
  -- table (017's self-test refuses it), or that table exports only some rows.
  v_excluded constant text[] := array['backup_snapshots', 'strava_oauth_state', 'strava_session_links', 'strava_sync_state', 'strava_tokens'];
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

revoke all on function public.backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;

-- A convention for agent sessions, not an enforcement boundary: the roles they
-- use bypass RLS and can still read sessions directly (see the header).
--
-- EVERY sessions column except strava_activity_id, listed explicitly. A new
-- sessions column is NOT in this view until a migration adds it here on
-- purpose — `s.*` would silently start exposing whatever is added next,
-- strava_activity_id included. Column list confirmed against
-- information_schema.columns on 2026-11-16.
create or replace view public.sessions_no_strava
with (security_invoker = true)
as
select
  s.id,
  s.date,
  s.type,
  s.label,
  s.duration,
  s.srpe,
  s.prs,
  s.exercises,
  s.coach_note,
  s.created_at,
  s.status,
  s.coach_flag,
  -- An adopted row shows what the athlete had before the importer wrote it.
  case when l.wrote_avg_watts then l.prior_avg_watts else s.avg_watts end as avg_watts,
  case when l.wrote_avg_hr    then l.prior_avg_hr    else s.avg_hr    end as avg_hr,
  s.distance_m,
  s.user_id,
  s.source,
  s.date_iso,
  s.benchmark_key
from public.sessions s
left join public.strava_session_links l on l.session_id = s.id
-- Importer-inserted rows are Strava data through and through: hidden.
where l.origin is distinct from 'inserted'
  -- Fail closed: a linked row with no provenance cannot be shown safely.
  and (l.session_id is not null or s.strava_activity_id is null);

revoke all on public.sessions_no_strava from public, anon, authenticated;

comment on view public.sessions_no_strava is
  'sessions without Strava data, for AI agent sessions (Strava API Policy '
  '§5.3; #631). Hides importer-inserted rows and any linked row without '
  'provenance; on adopted rows avg_watts / avg_hr show the athlete''s prior '
  'values where the importer wrote them; strava_activity_id is omitted. '
  'security_invoker, so the caller''s own privileges apply. A convention for '
  'agent sessions, not a boundary: the connector, postgres and service_role '
  'roles bypass RLS; anon and authenticated cannot read it. Explicit '
  'column list: a new sessions column must be added here deliberately.';

-- Self-test. Every check raises; nothing here writes. It calls
-- backup_snapshot() exactly as 017's self-test does and reads only the
-- payload's keys and its `excluded` array — no row content.
do $$
declare
  v_excluded constant text[] := array['backup_snapshots', 'strava_oauth_state', 'strava_session_links', 'strava_sync_state', 'strava_tokens'];
  v_expected text[];
  v_tables   text[];
  v_counts   text[];
  v_snap     jsonb;
  v_rel      text;
  v_cols     text[];
begin
  v_snap := public.backup_snapshot();

  if v_snap->'excluded' is distinct from to_jsonb(v_excluded) then
    raise exception '018: excluded is %, want %', v_snap->'excluded', to_jsonb(v_excluded);
  end if;
  if v_snap->'schema_version' is distinct from '2'::jsonb then
    raise exception '018: schema_version is %, want 2', v_snap->'schema_version';
  end if;

  foreach v_rel in array v_excluded loop
    if (v_snap->'tables') ? v_rel or (v_snap->'counts') ? v_rel then
      raise exception '018: the snapshot exports excluded table %', v_rel;
    end if;
  end loop;
  if not ((v_snap->'tables') ? 'sessions' and (v_snap->'counts') ? 'sessions') then
    raise exception '018: the snapshot no longer exports sessions';
  end if;
  if (v_snap->'tables') ? 'sessions_no_strava' then
    raise exception '018: the snapshot exports the view sessions_no_strava';
  end if;

  -- Everything else is still covered: keys equal the catalogue's base tables
  -- minus the exclusions, as 017 checks.
  select coalesce(array_agg(c.relname::text order by c.relname::text collate "C"), '{}')
    into v_expected
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and c.relname::text <> all (v_excluded);
  select coalesce(array_agg(k order by k collate "C"), '{}') into v_tables
    from jsonb_object_keys(v_snap->'tables') k;
  select coalesce(array_agg(k order by k collate "C"), '{}') into v_counts
    from jsonb_object_keys(v_snap->'counts') k;
  if v_tables is distinct from v_expected or v_counts is distinct from v_expected then
    raise exception '018: snapshot keys % / % do not match catalogue base tables minus exclusions %',
      v_tables, v_counts, v_expected;
  end if;

  if has_function_privilege('public', 'public.backup_snapshot()', 'execute')
     or has_function_privilege('anon', 'public.backup_snapshot()', 'execute')
     or has_function_privilege('authenticated', 'public.backup_snapshot()', 'execute')
     or not has_function_privilege('service_role', 'public.backup_snapshot()', 'execute') then
    raise exception '018: backup_snapshot() has wrong EXECUTE (want public/anon/authenticated false, service_role true)';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p
                 where p.oid = 'public.backup_snapshot()'::regprocedure
                   and p.prosecdef
                   and p.provolatile = 's'
                   and p.proowner = 'postgres'::regrole
                   and p.proconfig @> array['search_path=""']) then
    raise exception '018: backup_snapshot() is not STABLE SECURITY DEFINER owned by postgres with search_path=""';
  end if;

  -- The view: invoker rights, no strava_activity_id, no browser grants.
  if not exists (select 1 from pg_catalog.pg_class c
                 where c.oid = 'public.sessions_no_strava'::regclass
                   and c.relkind = 'v'
                   and c.reloptions @> array['security_invoker=true']) then
    raise exception '018: sessions_no_strava is not a security_invoker view';
  end if;
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.sessions_no_strava'::regclass and a.attnum > 0 and not a.attisdropped;
  if 'strava_activity_id' = any (v_cols) then
    raise exception '018: sessions_no_strava exposes strava_activity_id';
  end if;
  if has_table_privilege('anon', 'public.sessions_no_strava', 'select')
     or has_table_privilege('authenticated', 'public.sessions_no_strava', 'select') then
    raise exception '018: a browser role can select sessions_no_strava';
  end if;

  raise notice '018: snapshot excludes %, still exports sessions and % tables; view sessions_no_strava ok (% columns)',
    v_excluded, cardinality(v_expected), cardinality(v_cols);
end $$;
