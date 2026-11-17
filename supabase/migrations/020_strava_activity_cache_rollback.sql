-- Rollback for 020_strava_activity_cache.sql. NOT auto-applied.
--
-- WHAT IT COSTS. strava-activity reads and writes strava_activity_cache, so
-- undeploy that function first, or every session page answers 502. The cached
-- Strava data is dropped with the table, which is the point: nothing in it may
-- outlive seven days, and it is in no backup.
--
-- RUN IT INSIDE ONE TRANSACTION, as postgres. The file does not open one
-- itself: wrap it in begin/commit (the #628 apply method does). Order within
-- it: unschedule the sweep (it would fail hourly on a missing function), drop
-- the function, drop the table, then restore 018's backup_snapshot() byte for
-- byte (the five-name exclusion list). The table goes before the function is
-- restored, so even under autocommit there is never a moment the table exists
-- and is exported; inside one transaction a failure leaves 020 fully in place.
--
-- Roll this back BEFORE 019's, 018's and 012's rollbacks: the table references
-- strava_session_links (012).

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '020 ROLLBACK must run as postgres: current_user=%', current_user;
  END IF;
END $$;

-- cron.unschedule(name) raises when no such job exists, so only when it does.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'strava-activity-cache-sweep') THEN
    PERFORM cron.unschedule('strava-activity-cache-sweep');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.strava_activity_cache_sweep();
DROP TABLE IF EXISTS public.strava_activity_cache;

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

-- Read-back from the catalogue only (no snapshot is taken, so no row is read).
DO $$
BEGIN
  IF position('array[''backup_snapshots'', ''strava_oauth_state'', ''strava_session_links'', ''strava_sync_state'', ''strava_tokens''];'
              in pg_catalog.pg_get_functiondef('public.backup_snapshot()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '020 ROLLBACK: backup_snapshot() does not carry 018''s exclusion list';
  END IF;
  IF to_regclass('public.strava_activity_cache') IS NOT NULL THEN
    RAISE EXCEPTION '020 ROLLBACK: strava_activity_cache still exists';
  END IF;
  IF to_regprocedure('public.strava_activity_cache_sweep()') IS NOT NULL THEN
    RAISE EXCEPTION '020 ROLLBACK: strava_activity_cache_sweep() still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'strava-activity-cache-sweep') THEN
    RAISE EXCEPTION '020 ROLLBACK: the cron job strava-activity-cache-sweep still exists';
  END IF;
END $$;
