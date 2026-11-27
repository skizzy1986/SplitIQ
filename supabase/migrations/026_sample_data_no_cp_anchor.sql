-- 026_sample_data_no_cp_anchor.sql
-- Replaces public.sample_data_load so a load no longer inserts a 200 W
-- rowing_cp placeholder (#819, slice S1, hidden-CP AC 45).
--
-- NOT auto-applied. SplitIQ dev only, never production. 026 never goes to
-- production. Apply only on Scott's explicit yes. This file does not delete
-- existing sample CP anchors on dev; a one-off retirement of those rows runs
-- only on a later yes.
--
-- Needs 024. The clear function is unchanged: it still deletes exactly the
-- anchors rows the ledger lists, so a tester who loaded sample data under 024
-- can still clear that placeholder. Session watt figures are still computed
-- from the same 200 W constant; only the anchors insert is gone.
--
-- Rollback: 026_sample_data_no_cp_anchor_rollback.sql restores the 024 loader
-- body, including the placeholder insert.

begin;

do $$
begin
  if to_regprocedure('public.sample_data_load(uuid, date, boolean)') is null then
    raise exception '026: apply 024_sample_data first (#799); this replaces that loader';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Loader: 024's body without the anchors insert.
-- ---------------------------------------------------------------------------
create or replace function public.sample_data_load(
  p_user_id uuid,
  p_today   date    default null,
  p_force   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_cp     constant numeric := 200;           -- placeholder critical power, watts
  v_today  date := coalesce(p_today, (now() at time zone 'utc')::date);
  v_wid    uuid;
  v_ts     timestamptz;
  r        record;
  n_done   integer;
  n_plan   integer;
  n_cancel integer;
  n_work   integer := 0;
  n_sets   integer;
  n_anchor integer := 0;
begin
  if p_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'sample_data_load: unknown user' using errcode = '22023';
  end if;

  -- One load or clear at a time per user.
  perform pg_advisory_xact_lock(hashtextextended('sample_data:' || p_user_id::text, 0));

  if exists (select 1 from public.sample_data_rows l where l.user_id = p_user_id) then
    return jsonb_build_object('status', 'already_loaded');
  end if;
  if not p_force and (
       exists (select 1 from public.sessions s where s.user_id = p_user_id)
    or exists (select 1 from public.strength_workouts w where w.user_id = p_user_id)
  ) then
    return jsonb_build_object('status', 'has_own_data');
  end if;

  -- ERG: past 8 weeks (k = -56 .. -1) and the next 8 days (k = 0 .. 7).
  -- wob is a repeatable -4..4 wobble, so no two days read identically.
  with spec (kind, secs, pct0, gain, srpe, hr0, hrd, label, note) as (values
    ('steady',    3600, 0.62, 0.06, 4, 150, 11, 'Steady 60 min',
      'Sample plan: steady rowing in the UT2 zone, about 65% of CP. Keep it conversational.'),
    ('long',      4800, 0.60, 0.06, 5, 148, 10, 'Long steady 80 min',
      'Sample plan: the long one. Easy UT2 watts the whole way, steady rate.'),
    ('easy',      2400, 0.57, 0.04, 3, 134,  6, 'Easy 40 min',
      'Sample plan: an easy recovery row, well under UT2.'),
    ('intervals', 3600, 0.80, 0.07, 7, 160,  4, 'Intervals',
      'Sample plan: intervals at or above threshold, with easy rowing between pieces.'),
    ('test1',     0,    0,    0,    10, 180, 0, '2k test',   null),
    ('test2',     0,    0,    0,    10, 182, 0, '2k retest', null)
  ),
  days as (
    select g.k,
           v_today + g.k                                         as day,
           extract(isodow from (v_today + g.k))::integer          as dow,
           least(1, (g.k + 56)::numeric / 56)                     as prog,
           ((abs(g.k) * 7 + 13) % 9) - 4                          as wob,
           (g.k + 56) / 7                                         as wk
      from generate_series(-56, 7) as g(k)
  ),
  kinds as (
    select d.*,
           case
             when d.k < 0 then
               case
                 when d.dow = 2 then 'intervals'
                 when d.dow = 3 then 'steady'
                 when d.dow = 6 and d.k between -56 and -50 then 'test1'
                 when d.dow = 6 and d.k between -14 and -8  then 'test2'
                 when d.dow = 6 then 'long'
                 when d.dow = 5 and d.wk % 2 = 0 then 'easy'
               end
             else
               case
                 when d.dow = 2 then 'intervals'
                 when d.dow = 3 then 'steady'
                 when d.dow = 5 then 'easy'
                 when d.dow = 6 then 'long'
                 when d.k = 0   then 'easy'   -- always something planned today
               end
           end as kind,
           (d.k < 0 and (abs(d.k) * 7 + 3) % 10 = 0) as skipped
      from days d
  ),
  chosen as (
    select kd.*,
           -- A skipped day is simply absent, except the most recent one, which
           -- is kept as a cancelled session so the Log shows one.
           case
             when kd.kind is null then null
             when kd.k >= 0 then 'planned'
             when kd.skipped and kd.kind not in ('test1', 'test2') then
               case when kd.k = (select max(x.k) from kinds x
                                  where x.skipped and x.kind is not null
                                    and x.kind not in ('test1', 'test2'))
                    then 'cancelled' else 'absent' end
             else 'logged'
           end as status
      from kinds kd
  ),
  rows as (
    select c.day, c.k, c.status, c.kind,
           case when c.kind = 'intervals'
                then (array['4x8 min intervals', '6x4 min intervals', '3x12 min intervals'])[1 + c.wk % 3]
                else s.label end as label,
           s.note,
           s.srpe + case when c.kind in ('steady', 'long', 'intervals') and c.wob > 2 then 1 else 0 end as srpe,
           s.hr0 - s.hrd * c.prog + c.wob * 0.7 as hr,
           case
             when c.kind = 'test1' then 245
             when c.kind = 'test2' then 256
             when c.status = 'planned' then round(c_cp * (s.pct0 + s.gain))
             else round(c_cp * (s.pct0 + s.gain * c.prog) + c.wob)
           end as watts,
           s.secs
      from chosen c join spec s on s.kind = c.kind
     where c.status <> 'absent'
  ),
  timed as (
    select r2.*,
           case when r2.kind in ('test1', 'test2')
                then round(2000 / power(r2.watts / 2.8, 1.0 / 3.0))
                else r2.secs end as dur_s
      from rows r2
  ),
  ins as (
    insert into public.sessions
      (user_id, date, type, label, duration, srpe, prs, exercises, coach_note,
       status, avg_watts, avg_hr, distance_m, source)
    select p_user_id,
           to_char(t.day, 'FMMM/FMDD/YY'),
           'erg',
           '[Sample] ' || t.label || case when t.status = 'cancelled' then ' (skipped)' else '' end,
           case when t.status = 'cancelled' then null
                else lpad(floor(t.dur_s / 60)::integer::text, 2, '0') || ':' || lpad(mod(t.dur_s::integer, 60)::text, 2, '0') end,
           case when t.status in ('logged') then t.srpe end,
           0,
           '[]'::jsonb,
           case when t.status = 'planned' then t.note end,
           t.status,
           case when t.status <> 'cancelled' then t.watts::integer end,
           case when t.status = 'logged' then round(t.hr)::integer end,
           case when t.status = 'logged'
                then case when t.kind in ('test1', 'test2') then 2000
                          else round(power(t.watts / 2.8, 1.0 / 3.0) * t.dur_s)::integer end
           end,
           'sample'
      from timed t
     order by t.day
    returning id, status
  ),
  led as (
    insert into public.sample_data_rows (user_id, table_name, row_id)
    select p_user_id, 'sessions', ins.id::text from ins
    returning 1
  )
  select count(*) filter (where ins.status = 'logged'),
         count(*) filter (where ins.status = 'planned'),
         count(*) filter (where ins.status = 'cancelled')
    into n_done, n_plan, n_cancel
    from ins;

  -- STRENGTH: Monday lower, Thursday upper, A/B alternating by week. One
  -- workout at a time, oldest first, so the rollup trigger's PR flags (a PR is
  -- a better estimated 1RM than every EARLIER workout) read chronologically.
  for r in
    select d.k, d.day,
           (d.k + 56)::numeric / 56 as prog,
           ((abs(d.k) * 7 + 13) % 9) - 4 as wob,
           case when d.dow = 1 then 'Lower Strength' else 'Upper Strength' end as session_type,
           (case when d.dow = 1 then 'lower' else 'upper' end)
             || case when ((d.k + 56) / 7) % 2 = 0 then '_a' else '_b' end as tpl
      from (select g.k, v_today + g.k as day,
                   extract(isodow from (v_today + g.k))::integer as dow
              from generate_series(-56, -1) as g(k)) d
     where d.dow in (1, 4)
       and (abs(d.k) * 5 + 1) % 9 <> 0
     order by d.day
  loop
    v_wid := md5('sample-workout|' || p_user_id::text || '|' || r.day::text)::uuid;
    v_ts  := (r.day::timestamp + interval '9 hours') at time zone 'utc';

    insert into public.strength_workouts
      (id, user_id, workout_date, session_type, label, srpe, status,
       started_at, completed_at, created_at, origin)
    values
      (v_wid, p_user_id, r.day, r.session_type,
       '[Sample] ' || case r.tpl when 'lower_a' then 'Lower A' when 'lower_b' then 'Lower B'
                                 when 'upper_a' then 'Upper A' else 'Upper B' end,
       case when r.wob > 1 then 7 else 6 end, 'completed',
       v_ts, v_ts + make_interval(mins => 50 + r.wob + 4), v_ts, 'custom');

    insert into public.sample_data_rows (user_id, table_name, row_id)
    values (p_user_id, 'strength_workouts', v_wid::text);

    insert into public.strength_sets
      (id, user_id, workout_id, exercise_id, exercise_name, set_index,
       weight_kg, reps, rpe, is_warmup, completed, created_at, hold_seconds)
    with tpl (name, pos, ex_id, ex_name, base_kg, step_kg, reps) as (values
      ('lower_a', 1, 'Barbell_Squat',                      'Barbell Squat',                      60,   5,   array[5, 5, 5]),
      ('lower_a', 2, 'Romanian_Deadlift',                  'Romanian Deadlift',                  70,   5,   array[8, 8, 8]),
      ('lower_a', 3, 'Dumbbell_Lunges',                    'Dumbbell Lunges',                    12.5, 2.5, array[10, 10, 8]),
      ('lower_b', 1, 'Leg_Press',                          'Leg Press',                          100,  10,  array[10, 10, 8]),
      ('lower_b', 2, 'Barbell_Hip_Thrust',                 'Barbell Hip Thrust',                 60,   5,   array[8, 8, 8]),
      ('lower_b', 3, 'Goblet_Squat',                       'Goblet Squat',                       16,   2,   array[10, 10, 10]),
      ('upper_a', 1, 'Barbell_Bench_Press_-_Medium_Grip',  'Barbell Bench Press - Medium Grip',  50,   2.5, array[5, 5, 5]),
      ('upper_a', 2, 'Bent_Over_Barbell_Row',              'Bent Over Barbell Row',              45,   2.5, array[8, 8, 8]),
      ('upper_a', 3, 'Standing_Military_Press',            'Standing Military Press',            30,   2.5, array[8, 8, 6]),
      ('upper_a', 4, 'Barbell_Curl',                       'Barbell Curl',                       20,   2.5, array[10, 10, 8]),
      ('upper_b', 1, 'Dumbbell_Bench_Press',               'Dumbbell Bench Press',               18,   2,   array[10, 10, 8]),
      ('upper_b', 2, 'Seated_Cable_Rows',                  'Seated Cable Rows',                  45,   5,   array[10, 10, 10]),
      ('upper_b', 3, 'Standing_Military_Press',            'Standing Military Press',            30,   2.5, array[8, 8, 6]),
      ('upper_b', 4, 'Barbell_Curl',                       'Barbell Curl',                       20,   2.5, array[10, 10, 8])
    ),
    work as (
      select t.*, g.si
        from tpl t, generate_series(0, 3) as g(si)
       where t.name = r.tpl
    )
    select md5('sample-set|' || v_wid::text || '|' || w.pos || '|' || w.si)::uuid,
           p_user_id, v_wid,
           (select e.id from public.exercises e where e.id = w.ex_id),
           w.ex_name,
           w.si + 1,
           -- si 0 is a warm-up at 60%; the working weight steps up every
           -- three weeks, so a PR is an event, not every session.
           case when w.si = 0 then round(w.base_kg * 0.6 / 2.5) * 2.5
                else w.base_kg + w.step_kg * floor(r.prog * 8 / 3) end,
           case when w.si = 0 then 5 else w.reps[w.si] end,
           case when w.si = 0 then null else 6.5 + w.si * 0.5 end,
           (w.si = 0),
           true,
           v_ts + make_interval(mins => w.pos * 12 + w.si),
           null
      from work w;

    -- The trigger just made this workout's Log row. Mark it and record it.
    update public.sessions s
       set source = 'sample'
      from public.strength_workouts w
     where w.id = v_wid and s.id = w.session_id and s.user_id = p_user_id;

    insert into public.sample_data_rows (user_id, table_name, row_id)
    select p_user_id, 'sessions', w.session_id::text
      from public.strength_workouts w
     where w.id = v_wid and w.session_id is not null;

    n_work := n_work + 1;
  end loop;

  select count(*) into n_sets from public.strength_sets ss
   where ss.user_id = p_user_id
     and ss.workout_id in (select l.row_id::uuid from public.sample_data_rows l
                            where l.user_id = p_user_id and l.table_name = 'strength_workouts');

  return jsonb_build_object(
    'status', 'loaded',
    'load_day', v_today,
    'erg_logged', n_done,
    'erg_planned', n_plan,
    'erg_cancelled', n_cancel,
    'strength_workouts', n_work,
    'strength_sets', n_sets,
    'anchors', n_anchor
  );
end;
$fn$;

revoke all on function public.sample_data_load(uuid, date, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.sample_data_load(uuid, date, boolean) to service_role;

comment on function public.sample_data_load(uuid, date, boolean) is
  'Stage about 8 weeks of clearly labelled, deterministic sample erg and strength sessions in one tester''s account (#799, #819). Does not insert a rowing_cp anchor. Refuses a second load, and refuses an account that already has sessions unless p_force. Returns {status, counts}. service_role only.';

-- ---------------------------------------------------------------------------
-- Self-test on synthetic users, in a subtransaction that always rolls back
-- (sentinel SQLSTATE 'SF026'). A failed assertion raises a normal error and
-- rolls the whole file back. Existing accounts and their anchors are not
-- touched.
-- ---------------------------------------------------------------------------
do $$
declare
  ua constant uuid := 'f0260000-0000-4000-8000-00000000000a';
  ub constant uuid := 'f0260000-0000-4000-8000-00000000000b';
  day constant date := date '2026-11-27';
  ra jsonb;
  rc jsonb;
  aid uuid;
begin
  begin
    insert into auth.users (id) values (ua), (ub);

    -- H45: a load creates no anchors row and the ledger records none.
    ra := public.sample_data_load(ua, day);
    if ra->>'status' <> 'loaded' then
      raise exception '026 self-test: load did not report loaded';
    end if;
    if (ra->>'anchors')::int <> 0 then
      raise exception '026 self-test: load reported an anchors count';
    end if;
    if exists (select 1 from public.anchors where user_id = ua) then
      raise exception '026 self-test: load inserted an anchors row';
    end if;
    if exists (
      select 1 from public.sample_data_rows
       where user_id = ua and table_name = 'anchors'
    ) then
      raise exception '026 self-test: load wrote an anchors ledger row';
    end if;
    -- Sessions and workouts still load; only the anchor is gone.
    if (ra->>'erg_logged')::int < 20 or (ra->>'erg_planned')::int < 4
       or (ra->>'erg_cancelled')::int <> 1
       or (ra->>'strength_workouts')::int < 12 then
      raise exception '026 self-test: session counts out of range';
    end if;

    -- H45: clear still removes a ledgered anchor left by an earlier load.
    insert into public.anchors (user_id, key, value, unit, status, source)
      values (ua, 'rowing_cp', '200', 'W', 'provisional', 'sample')
      returning id into aid;
    insert into public.sample_data_rows (user_id, table_name, row_id)
      values (ua, 'anchors', aid::text);
    -- A tester's own, non-ledgered CP on another account is not touched.
    insert into public.anchors (user_id, key, value, unit, status, source)
      values (ub, 'rowing_cp', '255', 'W', 'confirmed', 'manual');

    rc := public.sample_data_clear(ua);
    if (rc->>'anchors')::int <> 1 then
      raise exception '026 self-test: clear did not remove the ledgered anchor';
    end if;
    if exists (select 1 from public.anchors where user_id = ua) then
      raise exception '026 self-test: clear left a ledgered anchor behind';
    end if;
    if (select count(*) from public.anchors
         where user_id = ub and key = 'rowing_cp' and value = '255') <> 1 then
      raise exception '026 self-test: clear touched another user''s anchor';
    end if;

    -- H41: other user, anon and signed-out cannot call the loaders they
    -- should not. sample_data_load stays service_role-only (SECURITY DEFINER,
    -- as in 024); the wrappers stay owner-only.
    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.sample_data_load(ua, day);
      raise exception '026 self-test: authenticated was allowed to call sample_data_load';
    exception when insufficient_privilege then
      null;
    end;
    begin
      perform public.sample_data_clear(ua);
      raise exception '026 self-test: authenticated was allowed to call sample_data_clear';
    exception when insufficient_privilege then
      null;
    end;

    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    begin
      perform public.load_my_sample_data();
      raise exception '026 self-test: a signed-out caller was not refused';
    exception when sqlstate '28000' then
      null;
    end;

    reset role;
    set local role anon;
    begin
      perform public.load_my_sample_data();
      raise exception '026 self-test: anon was allowed to call load_my_sample_data';
    exception when insufficient_privilege then
      null;
    end;

    reset role;
    perform pg_catalog.set_config('request.jwt.claim.sub', ub::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ub, 'role', 'authenticated')::text, true);
    set local role authenticated;
    -- The wrapper has no user argument, so B cannot name A. Clearing as B
    -- must not remove B's own non-ledgered CP.
    perform public.clear_my_sample_data();
    reset role;
    if (select count(*) from public.anchors
         where user_id = ub and key = 'rowing_cp' and value = '255') <> 1 then
      raise exception '026 self-test: B''s own CP was cleared';
    end if;

    raise exception using errcode = 'SF026', message = 'rollback synthetic rows';
  exception when sqlstate 'SF026' then
    null;
  end;

  -- Grants, read from the catalogue. Loaders stay service_role-only.
  if has_function_privilege('anon', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or has_function_privilege('anon', 'public.sample_data_clear(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.sample_data_clear(uuid)', 'execute')
     or has_function_privilege('anon', 'public.load_my_sample_data()', 'execute')
     or has_function_privilege('anon', 'public.clear_my_sample_data()', 'execute') then
    raise exception '026 self-test: a browser role can call a loader it should not';
  end if;
  if not has_function_privilege('service_role', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.sample_data_clear(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.load_my_sample_data()', 'execute')
     or not has_function_privilege('authenticated', 'public.clear_my_sample_data()', 'execute') then
    raise exception '026 self-test: an intended caller cannot run a sample-data function';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
