-- Rollback for 017_backup_snapshot_coverage.sql. NOT auto-applied.
--
-- THIS REOPENS #428. backup_snapshot() goes back to its hardcoded 8 tables, so
-- from the next cron run coach_log, anchors, exercises, exercise_media,
-- bp_readings, lab_results, injuries and any table added since are no longer
-- in the nightly snapshot. Do not run it to "unblock" a failure without first
-- establishing that 017 is the cause; a failing snapshot usually means a new
-- table whose rows cannot be serialised, which is fixed by excluding that
-- table in its own migration, not by dropping coverage for everything else.
--
-- What it restores, byte for byte in body and attributes, is the live
-- definition read with pg_get_functiondef on 2026-11-14 before 017 was
-- written: backup_snapshot() LANGUAGE sql, VOLATILE (the default, so not
-- spelled), SECURITY DEFINER, SET search_path TO 'public'; run_backup_snapshot()
-- LANGUAGE plpgsql, same attributes. CREATE OR REPLACE may change LANGUAGE and
-- volatility because the return types are unchanged (sql-createfunction.html,
-- via Context7 /websites/postgresql: only the return type is locked; "all
-- other function properties are assigned the values specified or implied").
--
-- NEVER DROPS public.backup_snapshots. 017 only captured it; it predates 017
-- and holds up to 30 snapshots. After this rollback the table holds a mix:
-- schema_version 2 rows written while 017 was live (tables nested under
-- "tables") and v1 rows written before and after (tables at the top level). A
-- restore must read payload->'schema_version' first; absent means v1. Retention
-- (latest 30) will age the v2 rows out within 30 days.
--
-- Order of operations: run as postgres; nothing else depends on this file.
-- The cron job is untouched either way.

do $$
begin
  if current_user <> 'postgres' then
    raise exception '017 ROLLBACK must run as postgres: current_user=%', current_user;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.backup_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'exported_at', now(),
    'counts', jsonb_build_object(
      'sessions',(select count(*) from sessions),
      'vitals',(select count(*) from vitals),
      'strength_workouts',(select count(*) from strength_workouts),
      'strength_sets',(select count(*) from strength_sets),
      'templates',(select count(*) from templates),
      'template_exercises',(select count(*) from template_exercises),
      'workout_assignments',(select count(*) from workout_assignments),
      'exercise_prefs',(select count(*) from exercise_prefs)
    ),
    'sessions',(select coalesce(jsonb_agg(t),'[]'::jsonb) from sessions t),
    'vitals',(select coalesce(jsonb_agg(t),'[]'::jsonb) from vitals t),
    'strength_workouts',(select coalesce(jsonb_agg(t),'[]'::jsonb) from strength_workouts t),
    'strength_sets',(select coalesce(jsonb_agg(t),'[]'::jsonb) from strength_sets t),
    'templates',(select coalesce(jsonb_agg(t),'[]'::jsonb) from templates t),
    'template_exercises',(select coalesce(jsonb_agg(t),'[]'::jsonb) from template_exercises t),
    'workout_assignments',(select coalesce(jsonb_agg(t),'[]'::jsonb) from workout_assignments t),
    'exercise_prefs',(select coalesce(jsonb_agg(t),'[]'::jsonb) from exercise_prefs t)
  );
$function$;

CREATE OR REPLACE FUNCTION public.run_backup_snapshot()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.backup_snapshots(payload) values (public.backup_snapshot());
  delete from public.backup_snapshots
   where id not in (select id from public.backup_snapshots order by created_at desc limit 30);
end; $function$;

revoke all on function public.backup_snapshot() from public, anon, authenticated;
revoke all on function public.run_backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;
grant execute on function public.run_backup_snapshot() to service_role;

-- Self-test: the v1 shape is back and only postgres + service_role can execute.
do $$
declare
  v_want text[] := array['counts', 'exercise_prefs', 'exported_at', 'sessions',
                         'strength_sets', 'strength_workouts', 'template_exercises',
                         'templates', 'vitals', 'workout_assignments'];
  v_want_counts text[] := array['exercise_prefs', 'sessions', 'strength_sets',
                                'strength_workouts', 'template_exercises',
                                'templates', 'vitals', 'workout_assignments'];
  v_snap jsonb;
  v_keys text[];
  v_fn   text;
begin
  v_snap := public.backup_snapshot();

  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_snap) k;
  if v_keys is distinct from v_want then
    raise exception '017 ROLLBACK: backup_snapshot() keys are %, want %', v_keys, v_want;
  end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_snap->'counts') k;
  if v_keys is distinct from v_want_counts then
    raise exception '017 ROLLBACK: counts keys are %, want %', v_keys, v_want_counts;
  end if;

  foreach v_fn in array array['public.backup_snapshot()', 'public.run_backup_snapshot()'] loop
    if exists (select 1
                 from pg_catalog.pg_proc p, aclexplode(p.proacl) a
                where p.oid = v_fn::regprocedure
                  and a.privilege_type = 'EXECUTE'
                  and a.grantee not in ('postgres'::regrole, 'service_role'::regrole))
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '017 ROLLBACK: % EXECUTE is not postgres + service_role only', v_fn;
    end if;
  end loop;

  raise warning '017 ROLLBACK: backup_snapshot() exports 8 tables again — #428 is reopened';
end $$;
