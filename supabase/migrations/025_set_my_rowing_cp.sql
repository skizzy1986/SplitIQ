-- 025_set_my_rowing_cp.sql
-- Saves a tester's rowing critical power (CP) in one step (#797, for #811).
-- SplitIQ dev only, for the testers build. Not for production.
--
-- Before this, the testers client retired the live rowing_cp anchor and then
-- inserted the new one as two requests, and put the old row back by hand if
-- the insert failed. Two requests can half-finish, and two saves at once can
-- both retire the same row and then collide on anchors_one_live_per_key.
-- set_my_rowing_cp() does both writes in one statement, so they commit or roll
-- back together, and queues saves for the same user on a transaction lock.
--
-- Security: SECURITY INVOKER, so it runs as the signed-in caller and the
-- anchors_owner RLS policy (user_id = auth.uid()) applies to every row it
-- touches. It only ever names the caller's own user id. Only authenticated may
-- execute it; anon, public and service_role may not.
--
-- Status stays 'unvalidated' (Scott, Gate 1): a CP a tester types has not been
-- checked against a test. Bounds 50-500 W match MIN_CP / MAX_CP in
-- web/src/utils/firstRunGuide.js, which #811 pins to the same numbers.
--
-- Rollback: 025_set_my_rowing_cp_rollback.sql drops the function. Rows it
-- saved stay; they are ordinary anchors rows.

begin;

create function public.set_my_rowing_cp(p_watts integer) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_retired integer;
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rowing_cp:' || v_uid::text, 0));

  -- clock_timestamp(), not now(): a save that waited on the lock must not
  -- record a retirement earlier than the row it retires was created.
  update public.anchors set superseded_at = pg_catalog.clock_timestamp()
   where user_id = v_uid and key = 'rowing_cp' and superseded_at is null;
  get diagnostics v_retired = row_count;

  insert into public.anchors (user_id, key, value, unit, status, source)
  values (v_uid, 'rowing_cp', p_watts::text, 'W', 'unvalidated', 'tester');

  return pg_catalog.jsonb_build_object('status', 'saved', 'watts', p_watts, 'replaced', v_retired > 0);
end;
$fn$;

revoke all on function public.set_my_rowing_cp(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_rowing_cp(integer) to authenticated;

comment on function public.set_my_rowing_cp(integer) is
  'Testers build (#797): retires the signed-in user''s live rowing_cp anchor and inserts the new one (W, unvalidated, tester) in one step. Runs as the caller under anchors RLS. 50-500 W.';

-- ---------------------------------------------------------------------------
-- Self-test. Runs on apply with synthetic users and rolls itself back
-- (sentinel SQLSTATE 'SF025', the pattern 019, 020, 023 and 024 use). A failed
-- check aborts the whole migration.
-- ---------------------------------------------------------------------------
do $$
declare
  ua constant uuid := 'f0250000-0000-4000-8000-00000000000a';
  ub constant uuid := 'f0250000-0000-4000-8000-00000000000b';
  uc constant uuid := 'f0250000-0000-4000-8000-00000000000c';
  r jsonb;
  n integer;
  v integer;
  bad integer[] := array[49, 501, null, 0, -200];
begin
  begin
    insert into auth.users (id) values (ua), (ub), (uc);
    insert into public.anchors (user_id, key, value, unit, status, source)
    values (ub, 'rowing_cp', '300', 'W', 'confirmed', 'manual');

    -- Signed in as A, through the same role and claims PostgREST sets.
    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- c3: first save, with no live row yet.
    r := public.set_my_rowing_cp(210);
    if r->>'status' <> 'saved' or (r->>'watts')::int <> 210 or (r->>'replaced')::boolean then
      raise exception '025 self-test c3: first save reported %', r;
    end if;

    -- c1: one live row with the value, W, unvalidated, tester.
    r := public.set_my_rowing_cp(215);
    if not (r->>'replaced')::boolean then
      raise exception '025 self-test c1: second save did not report replaced (%)', r;
    end if;
    select count(*) into n from public.anchors
     where user_id = ua and key = 'rowing_cp' and superseded_at is null
       and value = '215' and unit = 'W' and status = 'unvalidated' and source = 'tester';
    if n <> 1 or (select count(*) from public.anchors
                   where user_id = ua and key = 'rowing_cp' and superseded_at is null) <> 1 then
      raise exception '025 self-test c1: one live row expected, found %', n;
    end if;

    -- c2: history kept, the old row retired not deleted.
    if (select count(*) from public.anchors
         where user_id = ua and key = 'rowing_cp' and value = '210' and superseded_at is not null) <> 1
       or (select count(*) from public.anchors where user_id = ua and key = 'rowing_cp') <> 2 then
      raise exception '025 self-test c2: history was not kept';
    end if;

    -- c5: refused values change nothing.
    foreach v in array bad loop
      begin
        perform public.set_my_rowing_cp(v);
        raise exception '025 self-test c5: refused value % was accepted', v;
      exception when sqlstate '22023' then
        null;
      end;
    end loop;
    if (select count(*) from public.anchors where user_id = ua and key = 'rowing_cp') <> 2
       or (select value from public.anchors
            where user_id = ua and key = 'rowing_cp' and superseded_at is null) <> '215' then
      raise exception '025 self-test c5: refused values changed the rows';
    end if;

    -- c4: all or nothing. A throwaway check refuses only a live 220 W row, so
    -- the update that retires 215 W succeeds and then the insert fails. The
    -- old row must still be live.
    reset role;
    alter table public.anchors add constraint sf025_block_insert
      check (superseded_at is not null or value <> '220') not valid;
    set local role authenticated;
    begin
      perform public.set_my_rowing_cp(220);
      raise exception '025 self-test c4: the forced insert failure did not happen';
    exception when check_violation then
      null;
    end;
    reset role;
    alter table public.anchors drop constraint sf025_block_insert;
    set local role authenticated;
    if (select count(*) from public.anchors where user_id = ua and key = 'rowing_cp') <> 2
       or (select value from public.anchors
            where user_id = ua and key = 'rowing_cp' and superseded_at is null) <> '215' then
      raise exception '025 self-test c4: all or nothing failed, a failed save did not leave the old CP live';
    end if;

    -- c6: owner only. A cannot see B's rows, B is untouched, anon and a
    -- signed-out caller are refused.
    if (select count(*) from public.anchors where user_id = ub) <> 0 then
      raise exception '025 self-test c6: RLS let one user see another''s anchors';
    end if;
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    begin
      perform public.set_my_rowing_cp(200);
      raise exception '025 self-test c6: a signed-out caller was not refused';
    exception when sqlstate '28000' then
      null;
    end;
    reset role;
    set local role anon;
    begin
      perform public.set_my_rowing_cp(200);
      raise exception '025 self-test c6: anon was allowed to call set_my_rowing_cp';
    exception when insufficient_privilege then
      null;
    end;
    reset role;
    if (select count(*) from public.anchors where user_id = ub) <> 1
       or (select count(*) from public.anchors
            where user_id = ub and key = 'rowing_cp' and value = '300' and status = 'confirmed'
              and source = 'manual' and superseded_at is null) <> 1 then
      raise exception '025 self-test c6: other user untouched';
    end if;

    -- c8: saving over the 200 W sample placeholder retires it, and clearing
    -- sample data afterwards keeps the saved CP. Needs 024 (dev only).
    if to_regprocedure('public.sample_data_load(uuid,date,boolean)') is null then
      raise notice '025 self-test c8: skipped, 024 sample data is not applied here';
    else
      perform public.sample_data_load(uc, null, false);
      perform pg_catalog.set_config('request.jwt.claim.sub', uc::text, true);
      perform pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', uc, 'role', 'authenticated')::text, true);
      set local role authenticated;
      r := public.set_my_rowing_cp(240);
      if not (r->>'replaced')::boolean
         or (select count(*) from public.anchors
              where user_id = uc and key = 'rowing_cp' and source = 'sample' and superseded_at is null) <> 0 then
        raise exception '025 self-test c8: placeholder retired check failed (%)', r;
      end if;
      perform public.clear_my_sample_data();
      if (select count(*) from public.anchors
           where user_id = uc and key = 'rowing_cp' and superseded_at is null
             and value = '240' and source = 'tester') <> 1
         or (select count(*) from public.anchors where user_id = uc and source = 'sample') <> 0 then
        raise exception '025 self-test c8: own cp kept after clear check failed';
      end if;
      reset role;
    end if;

    raise exception using errcode = 'SF025', message = 'rollback synthetic rows';
  exception when sqlstate 'SF025' then
    null;
  end;

  -- Grants, read from the catalogue.
  if has_function_privilege('anon', 'public.set_my_rowing_cp(integer)', 'execute')
     or has_function_privilege('service_role', 'public.set_my_rowing_cp(integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_my_rowing_cp(integer)', 'execute') then
    raise exception '025 self-test: set_my_rowing_cp has the wrong EXECUTE grants';
  end if;
  if (select prosecdef from pg_catalog.pg_proc
       where oid = 'public.set_my_rowing_cp(integer)'::regprocedure) then
    raise exception '025 self-test: set_my_rowing_cp must be SECURITY INVOKER';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
