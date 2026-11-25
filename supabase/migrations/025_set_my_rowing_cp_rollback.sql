-- 025_set_my_rowing_cp_rollback.sql
-- Reverses 025_set_my_rowing_cp.sql (#797). DEV ONLY.
--
-- Drops the function and nothing else. CP rows it saved are ordinary anchors
-- rows and stay. After this, a testers build that calls set_my_rowing_cp gets
-- "Could not save that. Try again." and the tester's CP is unchanged.

begin;

drop function if exists public.set_my_rowing_cp(integer);

commit;

notify pgrst, 'reload schema';
