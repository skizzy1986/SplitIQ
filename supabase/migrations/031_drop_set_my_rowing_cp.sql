-- 031_drop_set_my_rowing_cp.sql
-- Drops 025's set_my_rowing_cp(integer), the legacy rowing-CP writer
-- (#819, slice S4b).
--
-- NOT auto-applied. SplitIQ dev only, and NEVER production: 031 never goes to
-- production (docs/COORDINATION.md, "#819 lane call (decision 14)"). Production
-- never had 025, so it has nothing to drop. This file is not applied to any
-- project yet. Apply only on Scott's explicit yes, to dev, after Gate 3.
-- 031 writes no rows: no insert, update or delete, and no backfill. Rows that
-- set_my_rowing_cp saved earlier (source 'tester', reason null) stay as
-- ordinary history.
--
-- WHY
--   028 added save_my_cp and the app has called it since #840, but left 025's
--   function in place so nothing broke mid-change. It writes no reason, ignores
--   locked, does not clamp valid_from and takes no expected live id, so while
--   it exists it is a way round the rules 028 enforces (A 40-42). Nothing in
--   web/src names it any more.
--
-- WHAT THIS DOES
--   1. Refuses to run (raises, nothing written) unless public.set_my_rowing_cp
--      (integer) is already on this project, and unless 028's save_my_cp and
--      save_my_hr_anchor are too. A project that never applied 025 (production)
--      aborts here, so 031 cannot run there by accident.
--   2. Drops that one function, by its full signature, with no CASCADE: if
--      anything depends on it, the drop fails and the whole migration rolls
--      back.
--   3. Self-test, in the same transaction, catalogue only: the function is
--      gone, public functions are exactly one fewer, public tables and
--      policies are unchanged, 028's two functions are still SECURITY INVOKER
--      with an empty search_path and EXECUTE for authenticated only, and
--      anchors still has its five 028 columns, the anchors_history index and
--      exactly one policy, anchors_owner. It writes nothing, so there is no
--      sentinel to roll back.
--
-- NOT CLOSED HERE: anchors_owner is "for all", so a signed-in client can still
-- write anchors directly through PostgREST. #839 tracks closing that before
-- A3r. 031 only removes the leftover function.
--
-- Rollback: 031_drop_set_my_rowing_cp_rollback.sql recreates 025's function
-- verbatim. Dev only. It is for an apply that needs undoing at once, not for
-- later: the restored writer ignores locks and reason codes.

begin;

do $$
begin
  if to_regprocedure('public.set_my_rowing_cp(integer)') is null then
    raise exception '031: public.set_my_rowing_cp(integer) is not on this project; 031 is for the dev project that applied 025 and 028, never production';
  end if;
  if to_regprocedure('public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)') is null
     or to_regprocedure('public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)') is null then
    raise exception '031: apply 028_anchor_provenance first; dropping set_my_rowing_cp would leave no CP writer';
  end if;
end $$;

-- Counts taken before the drop, kept for the self-test below in
-- transaction-local settings (nothing is written to any table).
select
  pg_catalog.set_config('s031.functions', (
    select count(*)::text from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'), true),
  pg_catalog.set_config('s031.tables', (
    select count(*)::text from pg_catalog.pg_tables
     where schemaname = 'public'), true),
  pg_catalog.set_config('s031.policies', (
    select count(*)::text from pg_catalog.pg_policies
     where schemaname = 'public'), true);

drop function public.set_my_rowing_cp(integer);

-- ---------------------------------------------------------------------------
-- Self-test (catalogue only; runs on apply, and a failed check aborts the whole
-- migration, so the drop does not land).
-- ---------------------------------------------------------------------------
do $$
declare
  fn_cp constant regprocedure := 'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)'::regprocedure;
  fn_hr constant regprocedure := 'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)'::regprocedure;
  n integer;
begin
  -- 1. The legacy writer is gone.
  if to_regprocedure('public.set_my_rowing_cp(integer)') is not null then
    raise exception '031 self-test: set_my_rowing_cp(integer) is still there';
  end if;

  -- 2. Only that function went; tables and policies did not move.
  select count(*) into n from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public';
  if n <> pg_catalog.current_setting('s031.functions')::integer - 1 then
    raise exception '031 self-test: public functions must be exactly one fewer';
  end if;
  select count(*) into n from pg_catalog.pg_tables where schemaname = 'public';
  if n <> pg_catalog.current_setting('s031.tables')::integer then
    raise exception '031 self-test: public tables changed';
  end if;
  select count(*) into n from pg_catalog.pg_policies where schemaname = 'public';
  if n <> pg_catalog.current_setting('s031.policies')::integer then
    raise exception '031 self-test: public policies changed';
  end if;

  -- 3. 028's writers are intact: invoker, empty search path, authenticated only.
  if has_function_privilege('anon', fn_cp, 'execute')
     or has_function_privilege('service_role', fn_cp, 'execute')
     or not has_function_privilege('authenticated', fn_cp, 'execute')
     or has_function_privilege('anon', fn_hr, 'execute')
     or has_function_privilege('service_role', fn_hr, 'execute')
     or not has_function_privilege('authenticated', fn_hr, 'execute') then
    raise exception '031 self-test: a 028 function has the wrong EXECUTE grants';
  end if;
  if (select count(*) from pg_catalog.pg_proc
       where oid in (fn_cp, fn_hr)
         and not prosecdef
         and proconfig @> array['search_path=""']) <> 2 then
    raise exception '031 self-test: a 028 function must be SECURITY INVOKER with an empty search_path';
  end if;

  -- 4. anchors is as 028 left it.
  select count(*) into n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.anchors'::regclass and not a.attisdropped
     and a.attname in ('reason', 'rule_id', 'rule_version', 'provenance', 'locked');
  if n <> 5 then
    raise exception '031 self-test: anchors lost a 028 column';
  end if;
  if to_regclass('public.anchors_history') is null then
    raise exception '031 self-test: anchors_history index is missing';
  end if;
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'anchors' and policyname = 'anchors_owner';
  if n <> 1 or (select count(*) from pg_catalog.pg_policies
                 where schemaname = 'public' and tablename = 'anchors') <> 1 then
    raise exception '031 self-test: anchors must still have exactly one policy, anchors_owner';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
