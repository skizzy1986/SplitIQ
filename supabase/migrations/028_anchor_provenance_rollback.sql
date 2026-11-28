-- 028_anchor_provenance_rollback.sql
-- Reverses 028_anchor_provenance.sql (#819, slice S4). NOT auto-applied.
-- Dev only, and only on Scott's explicit yes.
--
-- EXPORT FIRST. Dropping the five columns loses every reason, rule_id,
-- rule_version, provenance and locked value written since 028 was applied.
-- The anchor rows themselves stay: their key, value, unit, status, source,
-- valid_from and superseded_at are ordinary anchors columns.
--
-- Order: the two functions (nothing else depends on them), then the index,
-- then the columns and their checks. 025's set_my_rowing_cp is not touched.
-- After this, an app build that calls save_my_cp gets an error and the
-- user's CP is unchanged.

begin;

drop function if exists public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean);
drop function if exists public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean);

drop index if exists public.anchors_history;

alter table public.anchors
  drop column if exists locked,
  drop column if exists provenance,
  drop column if exists rule_version,
  drop column if exists rule_id,
  drop column if exists reason;

commit;

notify pgrst, 'reload schema';
