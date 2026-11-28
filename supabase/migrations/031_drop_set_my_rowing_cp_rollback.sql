-- 031_drop_set_my_rowing_cp_rollback.sql
-- Reverses 031_drop_set_my_rowing_cp.sql (#819, slice S4b). NOT auto-applied.
-- SplitIQ dev only, and NEVER production: running this on production would
-- CREATE set_my_rowing_cp there, and production never had it. It refuses to
-- run unless 028's save_my_cp is on the project, which production does not
-- have.
--
-- Recreates 025's function verbatim (the create function, the revoke, the
-- grant and the comment, copied from 025_set_my_rowing_cp.sql). It writes no
-- rows and does not touch 028: save_my_cp, save_my_hr_anchor, the five
-- anchors columns, the anchors_history index and the anchors_owner policy stay
-- as they are.
--
-- Use it only to undo a 031 apply at once. Once A3r or any rule writes
-- anchors, do not restore this writer: it ignores locked, reason and the
-- valid_from clamp.

begin;

do $$
begin
  if to_regprocedure('public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)') is null then
    raise exception '031 rollback: 028 is not on this project; this rollback is dev only, never production';
  end if;
  if to_regprocedure('public.set_my_rowing_cp(integer)') is not null then
    raise exception '031 rollback: set_my_rowing_cp(integer) already exists; nothing to restore';
  end if;
end $$;

create function public.set_my_rowing_cp(p_watts integer) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_retired integer;
  v_now timestamptz;
begin
  if v_uid is null then
    raise exception 'set_my_rowing_cp: not signed in' using errcode = '28000';
  end if;
  if p_watts is null or p_watts < 50 or p_watts > 500 then
    raise exception 'set_my_rowing_cp: rowing CP must be a whole number of watts from 50 to 500'
      using errcode = '22023';
  end if;

  -- One save at a time per user. A second save waits here until the first
  -- commits, then retires the row the first one inserted.
  -- The lock relies on READ COMMITTED, PostgREST's default: once the first
  -- save commits, the second one's update sees the row it inserted. Under
  -- REPEATABLE READ or SERIALIZABLE the second save fails with 23505 instead,
  -- which is safe (nothing changes) but shows the tester an error.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rowing_cp:' || v_uid::text, 0));

  -- One clock reading, taken after the lock, stamps both the retirement and
  -- the new row, so each hand-off is an exact tie and created_at order matches
  -- live order even after a lock wait. clock_timestamp(), not now(): now() is
  -- the transaction start, which can be earlier than the row being retired.
  v_now := pg_catalog.clock_timestamp();

  update public.anchors set superseded_at = v_now
   where user_id = v_uid and key = 'rowing_cp' and superseded_at is null;
  get diagnostics v_retired = row_count;

  insert into public.anchors (user_id, key, value, unit, status, source, created_at)
  values (v_uid, 'rowing_cp', p_watts::text, 'W', 'unvalidated', 'tester', v_now);

  return pg_catalog.jsonb_build_object('status', 'saved', 'watts', p_watts, 'replaced', v_retired > 0);
end;
$fn$;

revoke all on function public.set_my_rowing_cp(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_rowing_cp(integer) to authenticated;

comment on function public.set_my_rowing_cp(integer) is
  'Testers build (#797): retires the signed-in user''s live rowing_cp anchor and inserts the new one (W, unvalidated, tester) in one step. Runs as the caller under anchors RLS. 50-500 W.';

-- Catalogue check: restored as 025 made it (invoker, empty search path,
-- authenticated only).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc
                  where oid = 'public.set_my_rowing_cp(integer)'::regprocedure
                    and not prosecdef
                    and proconfig @> array['search_path=""']) then
    raise exception '031 rollback: set_my_rowing_cp must be SECURITY INVOKER with an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.set_my_rowing_cp(integer)', 'execute')
     or has_function_privilege('service_role', 'public.set_my_rowing_cp(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_my_rowing_cp(integer)', 'execute') then
    raise exception '031 rollback: set_my_rowing_cp has the wrong EXECUTE grants';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
