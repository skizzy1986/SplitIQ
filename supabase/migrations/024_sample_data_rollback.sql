-- 024_sample_data_rollback.sql
-- Reverses 024_sample_data.sql (#799). DEV ONLY.
--
-- Deletes every sample row first (so none is orphaned once the ledger that
-- identifies them is gone), then drops the functions and the ledger. Rows a
-- tester made themselves are not touched. Run it before 023 or 022 are
-- reversed; it does not depend on them.

begin;

do $$
declare
  u uuid;
begin
  for u in select distinct user_id from public.sample_data_rows loop
    perform public.sample_data_clear(u);
  end loop;
end $$;

drop function if exists public.clear_my_sample_data();
drop function if exists public.load_my_sample_data();
drop function if exists public.sample_data_clear(uuid);
drop function if exists public.sample_data_load(uuid, date, boolean);
drop table if exists public.sample_data_rows;

commit;

notify pgrst, 'reload schema';
