-- 024_sample_data.sql
-- DRAFT — not applied. Additive + reversible (#799). SplitIQ DEV ONLY.
-- Do not apply until Scott gives an explicit yes for this file, and never to
-- production: testers never get a production account (D32), and this file only
-- makes sense where testers exist.
--
-- WHY: a new tester account is empty, so every page a tester opens is blank.
-- This loads clearly labelled, made-up sessions into ONE tester's own account so
-- Today, Plan, Progress (Load, Erg, Strength, History) have something to show.
--
-- WHAT IT LOADS (per tester, relative to the day it is loaded):
--   * about 8 weeks of erg sessions (steady, long, easy, intervals, two 2k tests)
--     in the past, a handful of planned erg sessions from today forward, and one
--     cancelled session;
--   * about 8 weeks of strength workouts (lower and upper, a warm-up set and
--     three working sets per lift, weighted lifts only). The existing sync trigger turns each
--     completed workout into its Log row, exactly as when a tester logs one;
--   * one live rowing_cp anchor of 200 W, so the erg zones and the load model
--     have a threshold. It is a placeholder: the tester replaces it with a real
--     CP, which supersedes it.
-- NO vitals, health records, blood pressure, labs, injuries or Strava rows.
-- Nothing is read from any existing row, so nothing can come from real data.
--
-- DETERMINISTIC: no random(), no clock beyond the load day, no data read.
-- Every number is arithmetic on the day offset, so the same load day gives
-- the same rows for every tester. Row ids for strength workouts and sets are
-- md5 of (user, date), so a reload after a clear is identical too.
--
-- MARKING: every row is labelled "[Sample] ..." where there is a label, the
-- erg and rollup session rows carry source = 'sample', and every row is
-- recorded in public.sample_data_rows. The ledger is the authority: "clear"
-- deletes exactly the rows it lists, so a session the tester logged themselves
-- is never touched. Analytics exclude sample data with
--   where not exists (select 1 from public.sample_data_rows l
--                     where l.table_name = 'sessions' and l.row_id = s.id::text)
-- or, for sessions, `source <> 'sample'`.
--
-- ENTRY POINTS
--   sample_data_load(user, day, force)  service_role only. Called by the
--                                       invite-signup function after it creates
--                                       the account, or by Scott from SQL.
--   sample_data_clear(user)             service_role only.
--   load_my_sample_data()               signed-in tester, own account only.
--   clear_my_sample_data()              signed-in tester, own account only.
--                                       (backend for a later Settings button)
--
-- NEEDS 022 (#790) FIRST. The strength rollup trigger upserts sessions on the
-- key (date, label). Until 022 makes that key per owner, a second tester's
-- sample workout would collide with the first's, because the dates and labels
-- are the same. This file refuses to apply without 022.
--
-- APPLY INSIDE ONE TRANSACTION (it opens its own). A failed self-test at the
-- bottom rolls the whole file back.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sessions'::regclass
       and conname = 'sessions_user_date_label_key'
  ) or exists (
    select 1 from pg_constraint
     where conrelid = 'public.sessions'::regclass
       and conname = 'sessions_date_label_key'
  ) then
    raise exception '024: apply 022_sessions_unique_per_user first (#790); sample data needs the per-user sessions key';
  end if;
end $$;

-- The ledger. One row per staged row, keyed by table and primary key as text.
-- Dies with the account (a purge of a tester account clears it for free).
create table public.sample_data_rows (
  user_id    uuid not null references auth.users (id) on delete cascade,
  table_name text not null
             check (table_name in ('sessions', 'strength_workouts', 'anchors')),
  row_id     text not null,
  loaded_at  timestamptz not null default now(),
  primary key (user_id, table_name, row_id)
);

alter table public.sample_data_rows enable row level security;

-- A tester may see which of their rows are sample rows (a UI can badge them
-- or offer "Clear"); nobody can write the ledger from the browser.
create policy "Owner select" on public.sample_data_rows
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.sample_data_rows from public, anon, authenticated, service_role;
grant select on table public.sample_data_rows to authenticated;
grant select, insert, delete on table public.sample_data_rows to service_role;

comment on table public.sample_data_rows is
  'Ledger of staged sample rows (#799): which sessions, strength_workouts and anchors rows a loader created for a tester. sample_data_clear deletes exactly these. Written only by the loader (service_role).';

-- ---------------------------------------------------------------------------
-- Loader
-- ---------------------------------------------------------------------------
create function public.sample_data_load(
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
  v_aid    uuid;
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

  -- ANCHOR: a placeholder CP, unless the tester already has a live one.
  if not exists (
    select 1 from public.anchors a
     where a.user_id = p_user_id and a.key = 'rowing_cp' and a.superseded_at is null
  ) then
    insert into public.anchors (user_id, key, value, unit, status, source, valid_from, note)
    values (p_user_id, 'rowing_cp', c_cp::text, 'W', 'provisional', 'sample', v_today - 56,
            '[Sample] Placeholder critical power. Replace it with your own test result.')
    returning id into v_aid;
    insert into public.sample_data_rows (user_id, table_name, row_id)
    values (p_user_id, 'anchors', v_aid::text);
    n_anchor := 1;
  end if;

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

-- ---------------------------------------------------------------------------
-- Clear
-- ---------------------------------------------------------------------------
create function public.sample_data_clear(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  n_work   integer;
  n_sess   integer;
  n_anchor integer;
begin
  if p_user_id is null then
    raise exception 'sample_data_clear: user is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sample_data:' || p_user_id::text, 0));

  -- Workouts first: deleting one cascades its sets, and the existing trigger
  -- deletes its Log row.
  with del as (
    delete from public.strength_workouts w
     using public.sample_data_rows l
     where l.user_id = p_user_id and l.table_name = 'strength_workouts'
       and w.id::text = l.row_id and w.user_id = p_user_id
    returning 1
  ) select count(*) into n_work from del;

  with del as (
    delete from public.sessions s
     using public.sample_data_rows l
     where l.user_id = p_user_id and l.table_name = 'sessions'
       and s.id::text = l.row_id and s.user_id = p_user_id
    returning 1
  ) select count(*) into n_sess from del;

  with del as (
    delete from public.anchors a
     using public.sample_data_rows l
     where l.user_id = p_user_id and l.table_name = 'anchors'
       and a.id::text = l.row_id and a.user_id = p_user_id
    returning 1
  ) select count(*) into n_anchor from del;

  delete from public.sample_data_rows where user_id = p_user_id;

  return jsonb_build_object(
    'status', 'cleared',
    'strength_workouts', n_work,
    'sessions', n_sess,
    'anchors', n_anchor
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Self-service wrappers: the signed-in tester, their own account only.
-- ---------------------------------------------------------------------------
create function public.load_my_sample_data() returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'load_my_sample_data: not signed in' using errcode = '28000';
  end if;
  return public.sample_data_load(v_uid, null, false);
end;
$fn$;

create function public.clear_my_sample_data() returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'clear_my_sample_data: not signed in' using errcode = '28000';
  end if;
  return public.sample_data_clear(v_uid);
end;
$fn$;

revoke all on function public.sample_data_load(uuid, date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.sample_data_clear(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.load_my_sample_data()
  from public, anon, authenticated, service_role;
revoke all on function public.clear_my_sample_data()
  from public, anon, authenticated, service_role;
grant execute on function public.sample_data_load(uuid, date, boolean) to service_role;
grant execute on function public.sample_data_clear(uuid) to service_role;
grant execute on function public.load_my_sample_data() to authenticated;
grant execute on function public.clear_my_sample_data() to authenticated;

comment on function public.sample_data_load(uuid, date, boolean) is
  'Stage about 8 weeks of clearly labelled, deterministic sample erg and strength sessions in one tester''s account (#799). Refuses a second load, and refuses an account that already has sessions unless p_force. Returns {status, counts}. service_role only.';
comment on function public.sample_data_clear(uuid) is
  'Delete exactly the sample rows the ledger lists for one user, and the ledger rows (#799). Never touches a row the tester made. service_role only.';
comment on function public.load_my_sample_data() is
  'Signed-in tester: load sample data into their own account (#799).';
comment on function public.clear_my_sample_data() is
  'Signed-in tester: clear their own sample data (#799).';

-- ---------------------------------------------------------------------------
-- Self-test on synthetic users, in a subtransaction that always rolls back
-- (sentinel SQLSTATE 'SF024', the pattern 019, 020 and 023 use). A failed
-- assertion raises a normal error and rolls the whole file back.
-- ---------------------------------------------------------------------------
do $$
declare
  ua constant uuid := '00000000-0000-4000-8000-0000000000a1';
  ub constant uuid := '00000000-0000-4000-8000-0000000000b2';
  day constant date := date '2026-11-25';
  ra jsonb;
  rb jsonb;
  sig_a text;
  sig_b text;
  n integer;
begin
  begin
    insert into auth.users (id) values (ua), (ub);

    ra := public.sample_data_load(ua, day);
    rb := public.sample_data_load(ub, day);
    if ra->>'status' <> 'loaded' or rb->>'status' <> 'loaded' then
      raise exception '024 self-test: load did not report loaded (%, %)', ra, rb;
    end if;
    if ra - 'status' <> rb - 'status' then
      raise exception '024 self-test: two users got different counts (%, %)', ra, rb;
    end if;
    if (ra->>'erg_logged')::int < 20 or (ra->>'erg_planned')::int < 4
       or (ra->>'erg_cancelled')::int <> 1 or (ra->>'strength_workouts')::int < 12
       or (ra->>'anchors')::int <> 1 then
      raise exception '024 self-test: counts out of range (%)', ra;
    end if;

    -- Deterministic and per-user: same content for both testers.
    select md5(string_agg(concat_ws('|', date, type, label, duration, srpe, prs,
                                    exercises::text, coach_note, status,
                                    avg_watts, avg_hr, distance_m, source),
                           E'\n' order by date_iso, label))
      into sig_a from public.sessions where user_id = ua;
    select md5(string_agg(concat_ws('|', date, type, label, duration, srpe, prs,
                                    exercises::text, coach_note, status,
                                    avg_watts, avg_hr, distance_m, source),
                           E'\n' order by date_iso, label))
      into sig_b from public.sessions where user_id = ub;
    if sig_a is null or sig_a <> sig_b then
      raise exception '024 self-test: the two testers do not hold identical sample sessions';
    end if;

    -- Everything is labelled, flagged, in the ledger, and in the allowed window.
    if exists (select 1 from public.sessions s where s.user_id = ua and s.label not like '[Sample] %') then
      raise exception '024 self-test: a session is not labelled as sample';
    end if;
    if exists (select 1 from public.sessions s where s.user_id = ua and s.source <> 'sample') then
      raise exception '024 self-test: a session does not carry source = sample';
    end if;
    if exists (
      select 1 from public.sessions s
       where s.user_id = ua
         and not exists (select 1 from public.sample_data_rows l
                          where l.user_id = ua and l.table_name = 'sessions' and l.row_id = s.id::text)
    ) then
      raise exception '024 self-test: a session is missing from the ledger';
    end if;
    if exists (select 1 from public.strength_workouts w where w.user_id = ua and w.label not like '[Sample] %') then
      raise exception '024 self-test: a workout is not labelled as sample';
    end if;
    if exists (select 1 from public.sessions s where s.user_id = ua and (s.date_iso < day - 56 or s.date_iso > day + 7)) then
      raise exception '024 self-test: a session falls outside the 8 weeks back and 7 days ahead';
    end if;
    if exists (select 1 from public.sessions s where s.user_id = ua and s.status = 'planned' and s.date_iso < day) then
      raise exception '024 self-test: a planned session is in the past';
    end if;
    if not exists (select 1 from public.sessions s where s.user_id = ua and s.status = 'planned' and s.date_iso = day) then
      raise exception '024 self-test: nothing is planned for the load day';
    end if;
    -- The strength Log rows came from the trigger and were marked.
    select count(*) into n from public.sessions s
     where s.user_id = ua and s.type in ('Lower Strength', 'Upper Strength') and s.status = 'actual';
    if n <> (ra->>'strength_workouts')::int then
      raise exception '024 self-test: expected % strength Log rows, found %', ra->>'strength_workouts', n;
    end if;
    -- No health-side rows were created.
    if exists (select 1 from public.vitals where user_id = ua)
       or exists (select 1 from public.bp_readings where user_id = ua)
       or exists (select 1 from public.lab_results where user_id = ua)
       or exists (select 1 from public.injuries where user_id = ua)
       or exists (select 1 from public.strava_sync_state where user_id = ua) then
      raise exception '024 self-test: a health or Strava table received a row';
    end if;

    -- A second load is refused and changes nothing.
    if public.sample_data_load(ua, day)->>'status' <> 'already_loaded' then
      raise exception '024 self-test: a second load was not refused';
    end if;

    -- Clear removes exactly one tester's sample rows and spares their own.
    insert into public.sessions (user_id, date, type, label, status, source)
      values (ua, '11/24/26', 'erg', 'Tester own session', 'logged', 'bluetooth');
    if public.sample_data_clear(ua)->>'status' <> 'cleared' then
      raise exception '024 self-test: clear did not report cleared';
    end if;
    if (select count(*) from public.sessions where user_id = ua) <> 1
       or not exists (select 1 from public.sessions where user_id = ua and label = 'Tester own session') then
      raise exception '024 self-test: clear left sample rows or removed the tester''s own session';
    end if;
    if exists (select 1 from public.strength_workouts where user_id = ua)
       or exists (select 1 from public.strength_sets where user_id = ua)
       or exists (select 1 from public.anchors where user_id = ua)
       or exists (select 1 from public.sample_data_rows where user_id = ua) then
      raise exception '024 self-test: clear left workouts, sets, anchors or ledger rows behind';
    end if;
    select md5(string_agg(concat_ws('|', date, type, label, duration, srpe, prs,
                                    exercises::text, coach_note, status,
                                    avg_watts, avg_hr, distance_m, source),
                           E'\n' order by date_iso, label))
      into sig_b from public.sessions where user_id = ub;
    if sig_b is distinct from sig_a then
      raise exception '024 self-test: clearing one tester changed another tester''s sample data';
    end if;

    -- Not loaded into an account that already has sessions, unless forced; and
    -- a reload after a clear reproduces the same rows.
    if public.sample_data_load(ua, day)->>'status' <> 'has_own_data' then
      raise exception '024 self-test: an account with its own session was not protected';
    end if;
    delete from public.sessions where user_id = ua;
    ra := public.sample_data_load(ua, day);
    select md5(string_agg(concat_ws('|', date, type, label, duration, srpe, prs,
                                    exercises::text, coach_note, status,
                                    avg_watts, avg_hr, distance_m, source),
                           E'\n' order by date_iso, label))
      into sig_b from public.sessions where user_id = ua;
    if sig_b is distinct from sig_a then
      raise exception '024 self-test: a reload did not reproduce the same rows';
    end if;

    -- A live CP the tester set themselves is never replaced.
    perform public.sample_data_clear(ub);
    insert into public.anchors (user_id, key, value, unit, status, source)
      values (ub, 'rowing_cp', '255', 'W', 'confirmed', 'manual');
    rb := public.sample_data_load(ub, day);
    if (rb->>'anchors')::int <> 0
       or (select count(*) from public.anchors where user_id = ub and key = 'rowing_cp' and value = '255') <> 1 then
      raise exception '024 self-test: the tester''s own CP was replaced (%)', rb;
    end if;
    perform public.sample_data_clear(ub);
    if not exists (select 1 from public.anchors where user_id = ub and value = '255') then
      raise exception '024 self-test: clear removed the tester''s own CP';
    end if;

    raise exception using errcode = 'SF024', message = 'rollback synthetic rows';
  exception when sqlstate 'SF024' then
    null;
  end;
end $$;

-- Catalogue assertions: who can reach what.
do $$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.sample_data_rows'::regclass) then
    raise exception '024 self-test: RLS is not enabled on sample_data_rows';
  end if;
  if has_table_privilege('anon', 'public.sample_data_rows', 'select')
     or has_table_privilege('authenticated', 'public.sample_data_rows', 'insert')
     or has_table_privilege('authenticated', 'public.sample_data_rows', 'update')
     or has_table_privilege('authenticated', 'public.sample_data_rows', 'delete') then
    raise exception '024 self-test: a browser role can read or write the ledger beyond its own select';
  end if;
  if has_function_privilege('anon', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or has_function_privilege('anon', 'public.sample_data_clear(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.sample_data_clear(uuid)', 'execute')
     or has_function_privilege('anon', 'public.load_my_sample_data()', 'execute')
     or has_function_privilege('anon', 'public.clear_my_sample_data()', 'execute') then
    raise exception '024 self-test: a browser role can call a loader it should not';
  end if;
  if not has_function_privilege('service_role', 'public.sample_data_load(uuid, date, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.sample_data_clear(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.load_my_sample_data()', 'execute')
     or not has_function_privilege('authenticated', 'public.clear_my_sample_data()', 'execute') then
    raise exception '024 self-test: an intended caller cannot run a sample-data function';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
