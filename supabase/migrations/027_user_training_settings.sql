-- 027_user_training_settings.sql
-- Per-account training settings, plus the two functions the new-user rowing
-- flow writes through (#819, slice S3, Gate 2 brief §3 "027").
--
-- NOT auto-applied. SplitIQ dev only until Scott says otherwise; this file is
-- not applied to either project yet. Apply only on Scott's explicit yes, which
-- also covers the row-content backfill below.
--
-- WHAT THIS DOES
--   public.user_training_settings   one row per account: the strap or RPE path
--                                   (H 6-9), year of birth (H 13), time zone,
--                                   base-block and screening dates, the HR
--                                   caution flag, and the depth preference
--                                   (H 39). Owner-only under RLS.
--   public.log_my_resting_hr        saves one resting-HR reading for a date.
--   public.rate_my_session          saves an sRPE (and optionally an average
--                                   HR) on one of the caller's completed
--                                   sessions.
--   Depth backfill                  an 'expert' row for each account that
--                                   already has a live, non-sample rowing_cp,
--                                   so it keeps seeing its CP (H 39).
--
-- SECURITY (H 41, as amended 27 Nov 2026): both functions are SECURITY INVOKER
-- with search_path = '', so they run as the signed-in caller under RLS and
-- only ever name the caller's own id. Only authenticated may execute them.
-- The 024 and 026 sample-data loaders stay SECURITY DEFINER; this rule starts
-- here.
--
-- GRANT ORDER (Gate 2 condition C1): this file revokes the table's privileges
-- ONCE, then grants column-level INSERT and UPDATE. Revoking a table's
-- privileges also revokes its column privileges, so no later migration (030)
-- may revoke at table level again or it would wipe these column grants and
-- every settings write would fail with 42501. 030 only adds column grants for
-- its own new columns. Never re-grant INSERT or UPDATE at table level: a
-- table-level grant overrides the column list.
--
-- PRIVACY: year of birth and the HR caution flag are personal. They are
-- deletable (set to null, or delete the row). The 017 backup snapshot covers
-- every public table, so an earlier snapshot can still hold a value after the
-- user has removed it.
--
-- Rollback: 027_user_training_settings_rollback.sql drops the functions and
-- the table. Export first: it deletes every account's settings.

begin;

-- Needs 022 only for the sessions table shape this reads; refuse early if the
-- two tables the functions write to are missing.
do $$
begin
  if to_regclass('public.sessions') is null
     or to_regclass('public.vitals') is null
     or to_regclass('public.anchors') is null then
    raise exception '027: sessions, vitals and anchors must exist first';
  end if;
end $$;

create table public.user_training_settings (
  user_id                uuid primary key
                         references auth.users (id) on delete cascade
                         default auth.uid(),
  hr_path                text check (hr_path in ('strap', 'rpe')),
  hr_path_chosen_on      date,
  birth_year             smallint check (birth_year between 1900 and 2100),
  time_zone              text check (time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  base_block_started_on  date,
  screening_completed_on date,
  hr_caution             boolean not null default false,
  depth                  text not null default 'simple'
                         check (depth in ('simple', 'expert')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.user_training_settings enable row level security;

-- One owner policy for every operation. (select auth.uid()) is evaluated once
-- per statement rather than once per row.
create policy user_training_settings_owner on public.user_training_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Table-level privileges: revoke ALL once (this also clears the default
-- grants Supabase gives a new public table, and any column grants), then give
-- back only what is meant. See GRANT ORDER above.
revoke all on table public.user_training_settings from public, anon, authenticated, service_role;
grant select, delete on table public.user_training_settings to authenticated;
grant select, insert, update, delete on table public.user_training_settings to service_role;

-- Column-level writes. user_id and created_at are never client-writable:
-- user_id comes from the default (auth.uid()) and RLS checks it. updated_at
-- is client-set, because a trigger would add a third function.
grant insert (hr_path, hr_path_chosen_on, birth_year, time_zone,
              base_block_started_on, screening_completed_on, hr_caution,
              depth, updated_at)
  on table public.user_training_settings to authenticated;
grant update (hr_path, hr_path_chosen_on, birth_year, time_zone,
              base_block_started_on, screening_completed_on, hr_caution,
              depth, updated_at)
  on table public.user_training_settings to authenticated;

comment on table public.user_training_settings is
  'Per-account training settings for the new-user rowing flow (#819): strap or RPE path, year of birth, time zone, base-block and screening dates, HR caution, depth. Owner-only RLS. Authenticated has column-level INSERT and UPDATE only; never revoke or grant at table level again (027 header).';

-- ---------------------------------------------------------------------------
-- Depth backfill (decision 6, H 39). An account with a live rowing_cp that did
-- not come from sample data keeps seeing its CP: depth 'expert'. A null source
-- counts as not sample. Row-content write: Scott's yes on applying 027 covers
-- it. The same statement is repeated in the self-test below, limited to its
-- synthetic users.
-- ---------------------------------------------------------------------------
-- BACKFILL START
insert into public.user_training_settings (user_id, depth)
select distinct a.user_id, 'expert'
  from public.anchors a
 where a.key = 'rowing_cp'
   and a.superseded_at is null
   and coalesce(a.source, '') <> 'sample'
on conflict (user_id) do nothing;
-- BACKFILL END

-- ---------------------------------------------------------------------------
-- log_my_resting_hr: one reading per date, as the caller.
-- ---------------------------------------------------------------------------
create function public.log_my_resting_hr(p_date date, p_bpm integer) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'log_my_resting_hr: not signed in' using errcode = '28000';
  end if;
  if p_date is null
     or p_date > ((pg_catalog.now() at time zone 'utc')::date + 1) then
    raise exception 'log_my_resting_hr: the date must be today or earlier'
      using errcode = '22023';
  end if;
  if p_bpm is null or p_bpm < 30 or p_bpm > 120 then
    raise exception 'log_my_resting_hr: resting heart rate must be 30 to 120 bpm'
      using errcode = '22023';
  end if;

  -- A new row is source 'manual'. An existing day keeps its source and every
  -- other column; only the resting HR changes.
  insert into public.vitals (user_id, date, rhr_bpm, source)
  values (v_uid, p_date, p_bpm, 'manual')
  on conflict (user_id, date) do update
    set rhr_bpm = coalesce(excluded.rhr_bpm, public.vitals.rhr_bpm);

  return pg_catalog.jsonb_build_object('status', 'saved');
end;
$fn$;

revoke all on function public.log_my_resting_hr(date, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.log_my_resting_hr(date, integer) to authenticated;

comment on function public.log_my_resting_hr(date, integer) is
  'Signed-in user: save one resting heart rate (30-120 bpm) for a date (#819). Runs as the caller under vitals RLS. A new day is source manual; an existing day keeps its other columns. Returns {status} only.';

-- ---------------------------------------------------------------------------
-- rate_my_session: sRPE, and optionally average HR, on the caller's own
-- completed session. Returns {status} only, never row data.
-- ---------------------------------------------------------------------------
create function public.rate_my_session(
  p_id     bigint,
  p_srpe   integer,
  p_avg_hr integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_link   bigint;
begin
  if v_uid is null then
    raise exception 'rate_my_session: not signed in' using errcode = '28000';
  end if;
  if p_id is null
     or p_srpe is null or p_srpe < 1 or p_srpe > 10
     or (p_avg_hr is not null and (p_avg_hr < 30 or p_avg_hr > 230)) then
    raise exception 'rate_my_session: sRPE must be 1 to 10 and average heart rate 30 to 230 bpm'
      using errcode = '22023';
  end if;

  -- The caller's own row only; under RLS another user's id finds nothing and
  -- is reported the same way as a missing one. The lock queues two raters.
  select s.status, s.strava_activity_id into v_status, v_link
    from public.sessions s
   where s.id = p_id and s.user_id = v_uid
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  -- Planned and cancelled rows are never rated (H 20).
  if v_status not in ('actual', 'completed', 'logged') then
    return pg_catalog.jsonb_build_object('status', 'not_completed');
  end if;

  -- The importer's adopted heart rate is never overwritten.
  if p_avg_hr is not null and v_link is not null then
    return pg_catalog.jsonb_build_object('status', 'linked');
  end if;

  update public.sessions
     set srpe = p_srpe, avg_hr = coalesce(p_avg_hr, avg_hr)
   where id = p_id and user_id = v_uid;

  return pg_catalog.jsonb_build_object('status', 'saved');
end;
$fn$;

revoke all on function public.rate_my_session(bigint, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.rate_my_session(bigint, integer, integer) to authenticated;

comment on function public.rate_my_session(bigint, integer, integer) is
  'Signed-in user: save sRPE (1-10), and average HR (30-230) when given, on one of their own completed sessions (#819). Runs as the caller under sessions RLS. Refuses planned or cancelled rows (not_completed) and an average HR on a Strava-linked row (linked). Returns {status} only.';

-- ---------------------------------------------------------------------------
-- Self-test. Runs on apply with synthetic users and rolls itself back
-- (sentinel SQLSTATE 'SF027', the pattern 019, 020, 023, 024, 025 and 026
-- use). A failed check aborts the whole migration. Invented values only.
-- ---------------------------------------------------------------------------
do $$
declare
  ua constant uuid := 'f0270000-0000-4000-8000-00000000000a';
  ub constant uuid := 'f0270000-0000-4000-8000-00000000000b';
  uc constant uuid := 'f0270000-0000-4000-8000-00000000000c';
  ud constant uuid := 'f0270000-0000-4000-8000-00000000000d';
  ue constant uuid := 'f0270000-0000-4000-8000-00000000000e';
  s_done   bigint;
  s_plan   bigint;
  s_cancel bigint;
  s_link   bigint;
  s_other  bigint;
  r jsonb;
  n integer;
  v integer;
  v_day constant date := (now() at time zone 'utc')::date - 1;
begin
  begin
    insert into auth.users (id) values (ua), (ub), (uc), (ud), (ue);

    -- Backfill fixtures: A manual CP, B sample-only CP, C none, D a retired
    -- CP only, E a live CP with no source.
    insert into public.anchors (user_id, key, value, unit, status, source, superseded_at)
    values (ua, 'rowing_cp', '230', 'W', 'confirmed', 'manual', null),
           (ub, 'rowing_cp', '200', 'W', 'provisional', 'sample', null),
           (ud, 'rowing_cp', '210', 'W', 'unvalidated', 'manual', now()),
           (ue, 'rowing_cp', '240', 'W', 'unvalidated', null, null);

    -- t39: the backfill statement, limited to the synthetic users.
    -- SELFTEST BACKFILL START
    insert into public.user_training_settings (user_id, depth)
    select distinct a.user_id, 'expert'
      from public.anchors a
     where a.key = 'rowing_cp'
       and a.superseded_at is null
       and coalesce(a.source, '') <> 'sample'
       and a.user_id in (ua, ub, uc, ud, ue)
    on conflict (user_id) do nothing;
    -- SELFTEST BACKFILL END
    if (select count(*) from public.user_training_settings
         where user_id in (ua, ue) and depth = 'expert') <> 2
       or (select count(*) from public.user_training_settings
            where user_id in (ub, uc, ud)) <> 0 then
      raise exception '027 self-test t39: the depth backfill picked the wrong accounts';
    end if;

    -- Sessions for rate_my_session. A: completed, planned, cancelled and a
    -- Strava-linked one. B: one completed row A must not reach.
    insert into public.sessions (user_id, date, type, label, status)
    values (ua, '11/20/26', 'erg', 'sf027 done', 'completed'),
           (ua, '11/21/26', 'erg', 'sf027 planned', 'planned'),
           (ua, '11/22/26', 'erg', 'sf027 cancelled', 'cancelled'),
           (ub, '11/20/26', 'erg', 'sf027 other', 'completed');
    insert into public.sessions (user_id, date, type, label, status, strava_activity_id, avg_hr)
    values (ua, '11/23/26', 'erg', 'sf027 linked', 'completed', 990270001, 140);
    select id into s_done   from public.sessions where user_id = ua and label = 'sf027 done';
    select id into s_plan   from public.sessions where user_id = ua and label = 'sf027 planned';
    select id into s_cancel from public.sessions where user_id = ua and label = 'sf027 cancelled';
    select id into s_link   from public.sessions where user_id = ua and label = 'sf027 linked';
    select id into s_other  from public.sessions where user_id = ub and label = 'sf027 other';

    -- Signed in as A, through the same role and claims PostgREST sets.
    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- t8 / t41: the owner can read their backfilled row and no one else's.
    if (select count(*) from public.user_training_settings) <> 1
       or (select count(*) from public.user_training_settings where user_id = ua) <> 1 then
      raise exception '027 self-test t8: RLS let A see another account''s settings';
    end if;

    -- t8: the column grants work. Update a permitted column (this is what 030
    -- must not break), insert-by-update of the path, and a null removal.
    update public.user_training_settings
       set hr_path = 'strap', hr_path_chosen_on = date '2026-11-27', updated_at = now()
     where user_id = ua;
    update public.user_training_settings set depth = 'simple' where user_id = ua;
    update public.user_training_settings set birth_year = 1990 where user_id = ua;
    update public.user_training_settings set birth_year = null where user_id = ua;
    if (select hr_path from public.user_training_settings where user_id = ua) <> 'strap'
       or (select depth from public.user_training_settings where user_id = ua) <> 'simple'
       or (select birth_year from public.user_training_settings where user_id = ua) is not null then
      raise exception '027 self-test t8: a permitted column write did not stick';
    end if;

    -- t8: a first insert as the owner, with user_id from the default, works
    -- for a user with no row yet (C), and B's row cannot be written by A.
    perform pg_catalog.set_config('request.jwt.claim.sub', uc::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', uc, 'role', 'authenticated')::text, true);
    insert into public.user_training_settings (hr_path, hr_path_chosen_on, updated_at)
    values ('rpe', date '2026-11-27', now())
    on conflict (user_id) do update set hr_path = excluded.hr_path;
    if (select count(*) from public.user_training_settings
         where user_id = uc and hr_path = 'rpe' and depth = 'simple') <> 1 then
      raise exception '027 self-test t8: the owner''s first insert failed';
    end if;
    -- Skip is an insert of rpe too, and a second write is an update.
    insert into public.user_training_settings (hr_path, hr_path_chosen_on, updated_at)
    values ('strap', date '2026-11-28', now())
    on conflict (user_id) do update set hr_path = excluded.hr_path;
    if (select hr_path from public.user_training_settings where user_id = uc) <> 'strap'
       or (select count(*) from public.user_training_settings where user_id = uc) <> 1 then
      raise exception '027 self-test t8: the second write did not update the same row';
    end if;

    -- t8: columns that are never client-writable are refused with 42501, and a
    -- value outside a check is refused with 23514.
    begin
      update public.user_training_settings set created_at = now() where user_id = uc;
      raise exception '027 self-test t8: created_at was writable';
    exception when insufficient_privilege then
      null;
    end;
    begin
      update public.user_training_settings set user_id = ua where user_id = uc;
      raise exception '027 self-test t8: user_id was writable';
    exception when insufficient_privilege then
      null;
    end;
    begin
      insert into public.user_training_settings (user_id, hr_path) values (ua, 'rpe');
      raise exception '027 self-test t8: user_id was insertable';
    exception when insufficient_privilege then
      null;
    end;
    begin
      update public.user_training_settings set hr_path = 'watch' where user_id = uc;
      raise exception '027 self-test t8: a bad path was accepted';
    exception when check_violation then
      null;
    end;
    begin
      update public.user_training_settings set birth_year = 1899 where user_id = uc;
      raise exception '027 self-test t8: a bad birth year was accepted';
    exception when check_violation then
      null;
    end;
    begin
      update public.user_training_settings set depth = 'deep' where user_id = uc;
      raise exception '027 self-test t8: a bad depth was accepted';
    exception when check_violation then
      null;
    end;

    -- t8: another user's row is neither visible, writable nor deletable.
    perform pg_catalog.set_config('request.jwt.claim.sub', ub::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ub, 'role', 'authenticated')::text, true);
    if (select count(*) from public.user_training_settings) <> 0 then
      raise exception '027 self-test t8: RLS let B see another account''s settings';
    end if;
    update public.user_training_settings set depth = 'expert' where user_id in (ua, uc);
    get diagnostics n = row_count;
    if n <> 0 then
      raise exception '027 self-test t8: B updated another account''s settings';
    end if;
    delete from public.user_training_settings where user_id in (ua, uc);
    get diagnostics n = row_count;
    if n <> 0 then
      raise exception '027 self-test t8: B deleted another account''s settings';
    end if;
    begin
      insert into public.user_training_settings (hr_path) values ('rpe');
      insert into public.user_training_settings (hr_path) values ('rpe');
      raise exception '027 self-test t8: a second row for one account was accepted';
    exception when unique_violation then
      null;
    end;

    -- t8: a signed-out caller and anon are refused.
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    if (select count(*) from public.user_training_settings) <> 0 then
      raise exception '027 self-test t8: a signed-out caller could read settings';
    end if;
    reset role;
    set local role anon;
    begin
      perform 1 from public.user_training_settings limit 1;
      raise exception '027 self-test t8: anon could read settings';
    exception when insufficient_privilege then
      null;
    end;
    reset role;

    -- As A again, for the owner delete and the functions.
    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- log_my_resting_hr: a new day, then the same day again.
    r := public.log_my_resting_hr(v_day, 52);
    if r->>'status' <> 'saved'
       or (select count(*) from public.vitals
            where user_id = ua and date = v_day
              and rhr_bpm = 52 and source = 'manual') <> 1 then
      raise exception '027 self-test rhr: a new reading was not saved as manual (%)', r;
    end if;
    reset role;
    update public.vitals set source = 'sync', hrv_ms = 65 where user_id = ua;
    set local role authenticated;
    perform public.log_my_resting_hr(v_day, 50);
    if (select count(*) from public.vitals where user_id = ua) <> 1
       or (select count(*) from public.vitals
            where user_id = ua and rhr_bpm = 50 and source = 'sync' and hrv_ms = 65) <> 1 then
      raise exception '027 self-test rhr: a second reading did not update only the resting HR';
    end if;
    foreach v in array array[29, 121, null, 0, -50] loop
      begin
        perform public.log_my_resting_hr(v_day, v);
        raise exception '027 self-test rhr: refused value % was accepted', v;
      exception when sqlstate '22023' then
        null;
      end;
    end loop;
    begin
      perform public.log_my_resting_hr(null, 55);
      raise exception '027 self-test rhr: a null date was accepted';
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform public.log_my_resting_hr(v_day + 4, 55);
      raise exception '027 self-test rhr: a future date was accepted';
    exception when sqlstate '22023' then
      null;
    end;
    if (select rhr_bpm from public.vitals where user_id = ua) <> 50 then
      raise exception '027 self-test rhr: a refused value changed the row';
    end if;

    -- rate_my_session: completed row, srpe only, then with average HR.
    r := public.rate_my_session(s_done, 6);
    if r->>'status' <> 'saved'
       or (select count(*) from public.sessions
            where id = s_done and srpe = 6 and avg_hr is null) <> 1 then
      raise exception '027 self-test rate: srpe alone was not saved (%)', r;
    end if;
    r := public.rate_my_session(s_done, 7, 148);
    if r->>'status' <> 'saved'
       or (select count(*) from public.sessions
            where id = s_done and srpe = 7 and avg_hr = 148) <> 1 then
      raise exception '027 self-test rate: srpe and average HR were not saved (%)', r;
    end if;
    -- A later rating without a heart rate keeps the one already saved.
    perform public.rate_my_session(s_done, 5);
    if (select count(*) from public.sessions
         where id = s_done and srpe = 5 and avg_hr = 148) <> 1 then
      raise exception '027 self-test rate: a rating without HR cleared the average HR';
    end if;
    -- Bounds.
    foreach v in array array[0, 11, null, -1] loop
      begin
        perform public.rate_my_session(s_done, v);
        raise exception '027 self-test rate: refused sRPE % was accepted', v;
      exception when sqlstate '22023' then
        null;
      end;
    end loop;
    foreach v in array array[29, 231, 0, -5] loop
      begin
        perform public.rate_my_session(s_done, 5, v);
        raise exception '027 self-test rate: refused average HR % was accepted', v;
      exception when sqlstate '22023' then
        null;
      end;
    end loop;
    begin
      perform public.rate_my_session(null, 5);
      raise exception '027 self-test rate: a null id was accepted';
    exception when sqlstate '22023' then
      null;
    end;
    if (select count(*) from public.sessions
         where id = s_done and srpe = 5 and avg_hr = 148) <> 1 then
      raise exception '027 self-test rate: a refused value changed the row';
    end if;
    -- Planned and cancelled rows are refused and unchanged. Each call goes
    -- into a variable first: a count in the same expression as the call reads
    -- the statement's snapshot and cannot see the call's own write.
    r := public.rate_my_session(s_plan, 5);
    if r->>'status' <> 'not_completed' then
      raise exception '027 self-test rate: a planned row was rated (%)', r;
    end if;
    r := public.rate_my_session(s_cancel, 5, 120);
    if r->>'status' <> 'not_completed'
       or (select count(*) from public.sessions
            where id in (s_plan, s_cancel) and (srpe is not null or avg_hr is not null)) <> 0 then
      raise exception '027 self-test rate: a planned or cancelled row was rated (%)', r;
    end if;
    -- A Strava-linked row: an average HR is refused and nothing changes; an
    -- sRPE alone is allowed and leaves the imported average HR alone.
    r := public.rate_my_session(s_link, 6, 150);
    if r->>'status' <> 'linked'
       or (select count(*) from public.sessions
            where id = s_link and srpe is null and avg_hr = 140) <> 1 then
      raise exception '027 self-test rate: a linked row accepted an average HR (%)', r;
    end if;
    r := public.rate_my_session(s_link, 6);
    if r->>'status' <> 'saved'
       or (select count(*) from public.sessions
            where id = s_link and srpe = 6 and avg_hr = 140) <> 1 then
      raise exception '027 self-test rate: sRPE alone on a linked row failed (%)', r;
    end if;
    -- Another user's row looks missing, and is not changed.
    if public.rate_my_session(s_other, 9, 100)->>'status' <> 'not_found' then
      raise exception '027 self-test rate: A reached B''s session';
    end if;
    reset role;
    if (select count(*) from public.sessions
         where id = s_other and srpe is null and avg_hr is null) <> 1 then
      raise exception '027 self-test rate: B''s session changed';
    end if;

    -- Signed-out and anon callers are refused.
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    set local role authenticated;
    begin
      perform public.rate_my_session(s_done, 5);
      raise exception '027 self-test rate: a signed-out caller was not refused';
    exception when sqlstate '28000' then
      null;
    end;
    begin
      perform public.log_my_resting_hr(v_day, 55);
      raise exception '027 self-test rhr: a signed-out caller was not refused';
    exception when sqlstate '28000' then
      null;
    end;
    reset role;
    set local role anon;
    begin
      perform public.rate_my_session(s_done, 5);
      raise exception '027 self-test rate: anon was allowed to call rate_my_session';
    exception when insufficient_privilege then
      null;
    end;
    begin
      perform public.log_my_resting_hr(v_day, 55);
      raise exception '027 self-test rhr: anon was allowed to call log_my_resting_hr';
    exception when insufficient_privilege then
      null;
    end;
    reset role;

    -- The owner can delete their own settings (removable, H 13) and only theirs.
    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from public.user_training_settings;
    get diagnostics n = row_count;
    reset role;
    if n <> 1
       or (select count(*) from public.user_training_settings where user_id in (ue, uc)) <> 2 then
      raise exception '027 self-test t8: an owner delete removed the wrong rows';
    end if;

    raise exception using errcode = 'SF027', message = 'rollback synthetic rows';
  exception when sqlstate 'SF027' then
    null;
  end;

  -- Grants, read from the catalogue.
  if has_table_privilege('anon', 'public.user_training_settings', 'select')
     or has_table_privilege('authenticated', 'public.user_training_settings', 'insert')
     or has_table_privilege('authenticated', 'public.user_training_settings', 'update')
     or has_table_privilege('authenticated', 'public.user_training_settings', 'truncate')
     or has_table_privilege('authenticated', 'public.user_training_settings', 'references')
     or has_table_privilege('authenticated', 'public.user_training_settings', 'trigger')
     or not has_table_privilege('authenticated', 'public.user_training_settings', 'select')
     or not has_table_privilege('authenticated', 'public.user_training_settings', 'delete') then
    raise exception '027 self-test: user_training_settings has the wrong table privileges';
  end if;
  if not has_column_privilege('authenticated', 'public.user_training_settings', 'depth', 'insert')
     or not has_column_privilege('authenticated', 'public.user_training_settings', 'depth', 'update')
     or has_column_privilege('authenticated', 'public.user_training_settings', 'user_id', 'insert')
     or has_column_privilege('authenticated', 'public.user_training_settings', 'user_id', 'update')
     or has_column_privilege('authenticated', 'public.user_training_settings', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.user_training_settings', 'created_at', 'update') then
    raise exception '027 self-test: user_training_settings has the wrong column privileges';
  end if;
  if has_function_privilege('anon', 'public.log_my_resting_hr(date, integer)', 'execute')
     or has_function_privilege('service_role', 'public.log_my_resting_hr(date, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.log_my_resting_hr(date, integer)', 'execute')
     or has_function_privilege('anon', 'public.rate_my_session(bigint, integer, integer)', 'execute')
     or has_function_privilege('service_role', 'public.rate_my_session(bigint, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.rate_my_session(bigint, integer, integer)', 'execute') then
    raise exception '027 self-test: a 027 function has the wrong EXECUTE grants';
  end if;
  if (select prosecdef from pg_catalog.pg_proc
       where oid = 'public.log_my_resting_hr(date, integer)'::regprocedure)
     or (select prosecdef from pg_catalog.pg_proc
          where oid = 'public.rate_my_session(bigint, integer, integer)'::regprocedure) then
    raise exception '027 self-test: a 027 function must be SECURITY INVOKER';
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'user_training_settings') <> 1 then
    raise exception '027 self-test: user_training_settings must have exactly one policy';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
