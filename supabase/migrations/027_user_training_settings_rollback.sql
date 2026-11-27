-- 027_user_training_settings_rollback.sql
-- Reverses 027_user_training_settings.sql (#819). DEV ONLY.
--
-- EXPORT FIRST. This drops public.user_training_settings, which deletes every
-- account's strap or RPE path, year of birth, time zone, screening dates, HR
-- caution flag and depth preference, including the depth rows 027 backfilled.
-- It also drops log_my_resting_hr and rate_my_session. Resting-HR readings and
-- session ratings those functions already saved are ordinary vitals and
-- sessions values and stay. Run it after any later migration that depends on
-- the table (028 onward) has been reversed.

begin;

drop function if exists public.rate_my_session(bigint, integer, integer);
drop function if exists public.log_my_resting_hr(date, integer);
drop table if exists public.user_training_settings;

commit;

notify pgrst, 'reload schema';
