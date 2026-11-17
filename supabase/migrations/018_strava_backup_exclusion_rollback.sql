-- Rollback for 018_strava_backup_exclusion.sql. NOT auto-applied.
--
-- THIS PUTS THE STRAVA CREDENTIALS BACK INTO THE NIGHTLY BACKUP if the
-- strava_* tables still exist. It restores 017's backup_snapshot() byte for
-- byte (v_excluded = backup_snapshots only), and 017 exports every public base
-- table — strava_tokens' access and refresh tokens included — from the next
-- cron run, kept for 30 days.
--
-- So 012's rollback must run WITH this one: in the same transaction, this file
-- first (012's rollback refuses to run while sessions_no_strava exists, because
-- the view depends on strava_session_links), then 012_strava_integration_
-- rollback.sql, then commit. Never commit this file alone while strava_tokens
-- exists. Deauthorize at Strava before that (see 012's rollback header).
--
-- Order of operations: run as postgres. The view goes first; the function
-- replace is independent of it.

do $$
begin
  if current_user <> 'postgres' then
    raise exception '018 ROLLBACK must run as postgres: current_user=%', current_user;
  end if;
end $$;

drop view if exists public.sessions_no_strava;

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

revoke all on function public.backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;

-- Read-back from the catalogue only (no snapshot is taken, so no row is read):
-- the body is 017's, and the view is gone.
do $$
begin
  if position('array[''backup_snapshots''];' in pg_catalog.pg_get_functiondef('public.backup_snapshot()'::regprocedure)) = 0 then
    raise exception '018 ROLLBACK: backup_snapshot() does not carry 017''s exclusion list';
  end if;
  if to_regclass('public.sessions_no_strava') is not null then
    raise exception '018 ROLLBACK: sessions_no_strava still exists';
  end if;
  if to_regclass('public.strava_tokens') is not null then
    raise warning '018 ROLLBACK: public.strava_tokens still exists and is now in the nightly backup — run 012''s rollback in this same transaction before committing';
  end if;
end $$;
