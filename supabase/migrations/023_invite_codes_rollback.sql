-- Rollback for 023_invite_codes.sql. NOT auto-applied. SplitIQ DEV ONLY.
--
-- Drops the invite functions and both tables. Accounts already created through
-- invite codes are untouched: they live in auth.users, not here. Dropping the
-- tables loses the codes and the attempt ledger, so the sign-up form stops
-- working until 023 is applied again and new codes are minted.

begin;

drop function if exists public.invite_signup_release(uuid);
drop function if exists public.invite_signup_claim(text, text, text);
drop table if exists public.invite_attempts;
drop table if exists public.invite_codes;

commit;

notify pgrst, 'reload schema';
