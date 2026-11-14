-- Rollback for 015_bp_readings.sql. NOT auto-applied.
--
-- DELIBERATELY A NO-OP. 015 created nothing in production: the table predates
-- it (live version 20261106035559). Dropping it would destroy health rows
-- (D9 re-entered BP via MCP) that 015 never created. Since 017 (#428) the
-- nightly public.backup_snapshot() covers health tables, but a snapshot can be
-- up to a day old, so still export first.
--
-- Removing bp_readings is its own destructive decision for Scott. If it is
-- ever taken, roll back 016 first (its rollback restores bp_readings' anon
-- grant), roll back the app code that reads the table, export, then drop:
--   select * from public.bp_readings order by measured_at;
--   -- then: drop table public.bp_readings;

select 1;
