-- 028_anchor_provenance.sql
-- Anchor provenance and a lock on public.anchors, plus the two functions every
-- anchor write goes through from now on (#819, slice S4).
--
-- NOT auto-applied. SplitIQ dev only until Scott says otherwise; this file is
-- not applied to either project yet. Apply only on Scott's explicit yes.
-- 028 writes no rows: no backfill (Gate 2 decision 5, 28 Nov 2026). Existing
-- anchors keep reason null and locked false.
--
-- WHAT THIS DOES
--   anchors.reason         why a row was written (allow-list below; no
--                          age_estimate, #819 decision 9).
--   anchors.rule_id,       which rule wrote it, for rule-written rows.
--   anchors.rule_version
--   anchors.provenance     a JSON object or null (what the value came from).
--   anchors.locked         while the live row is locked, rule sources (auto,
--                          estimate, observed) cannot replace it.
--   anchors_history        index for "the value valid on date D": the greatest
--                          valid_from <= D for the key, ties to the latest
--                          created_at.
--   public.save_my_cp           the rowing_cp writer.
--   public.save_my_hr_anchor    the max_hr and resting_hr writer.
--
-- Both functions retire the caller's live row of the key and insert the new
-- one in one statement each, inside one transaction, behind a per-user, per-key
-- advisory lock (rowing_cp uses the same key text as 025, so 025's
-- set_my_rowing_cp and save_my_cp queue behind each other while both exist).
-- They never delete. Every change, including lock and unlock, is a new row.
-- They return {status, id, replaced, valid_from, clamped} and no other data.
--
--   status 'saved'      a new live row was written.
--   status 'stale'      p_expected_live_id is not the current live id.
--   status 'locked'     the live row is locked and p_source is a rule source.
--   status 'unchanged'  same value, status, source, reason, valid_from and
--                       locked as the live row, or a lock/unlock with no live
--                       row. Nothing written.
--   status 'bad_date'   p_valid_from is null or later than the UTC date + 1.
--
-- valid_from clamp: earlier than the live row's valid_from is stored as the
-- live row's valid_from, with clamped = true. With no live row there is no
-- lower clamp. Lock and unlock rows carry the live value, unit, status, source
-- and valid_from.
--
-- SECURITY (H 41): SECURITY INVOKER with search_path = '', so they run as the
-- signed-in caller under the anchors_owner policy (user_id = auth.uid()) and
-- only ever name the caller's own id. Only authenticated may execute them.
-- Refusals raise 22023 with a message that names the field, never the value,
-- so no number reaches Sentry (H 42). Bad input is checked before any write,
-- so the table's own CHECK messages (which quote the failing row) never fire.
--
-- NOT CLOSED HERE: anchors_owner is "for all", so a signed-in client can still
-- write anchors directly through PostgREST. #839 tracks closing that before
-- A3r. 025's set_my_rowing_cp stays until S4b (031) drops it.
--
-- Rollback: 028_anchor_provenance_rollback.sql drops the two functions, the
-- index and the five columns. That loses every reason, rule and provenance
-- value written since; export them first. Saved values stay as ordinary rows.

begin;

do $$
begin
  if to_regclass('public.anchors') is null then
    raise exception '028: public.anchors must exist first';
  end if;
end $$;

alter table public.anchors
  add column reason text
    constraint anchors_reason_check check (
      reason is null or reason in (
        'manual', 'test', 'onboarding', 'observed_peak', 'rhr_baseline',
        'maximal_effort', 'maximal_effort_estimate', 'cp_decrease_auto',
        'peak_expired', 'proposal_accepted', 'proposal_declined', 'revert',
        'lock', 'unlock'
      )
    ),
  add column rule_id text,
  add column rule_version integer,
  add column provenance jsonb
    constraint anchors_provenance_object check (
      provenance is null or pg_catalog.jsonb_typeof(provenance) = 'object'
    ),
  add column locked boolean not null default false;

create index anchors_history
  on public.anchors (user_id, key, valid_from desc, created_at desc);

-- ---------------------------------------------------------------------------
-- save_my_cp: the rowing_cp writer, as the caller.
-- ---------------------------------------------------------------------------
create function public.save_my_cp(
  p_watts            integer,
  p_source           text,
  p_status           text,
  p_reason           text,
  p_valid_from       date,
  p_rule_id          text,
  p_rule_version     integer,
  p_provenance       jsonb,
  p_expected_live_id uuid default null,
  p_locked           boolean default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_has_live boolean;
  v_live     public.anchors%rowtype;
  v_value    text;
  v_unit     text;
  v_status   text;
  v_source   text;
  v_valid    date;
  v_locked   boolean;
  v_clamped  boolean := false;
  v_now      timestamptz;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'save_my_cp: not signed in' using errcode = '28000';
  end if;
  if p_watts is null or p_watts < 50 or p_watts > 500 then
    raise exception 'save_my_cp: rowing CP must be a whole number of watts from 50 to 500'
      using errcode = '22023';
  end if;
  if p_source is null
     or p_source not in ('test', 'manual', 'observed', 'estimate', 'auto', 'onboarding') then
    raise exception 'save_my_cp: source is not one the app writes' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('provisional', 'unvalidated', 'confirmed') then
    raise exception 'save_my_cp: status must be provisional, unvalidated or confirmed'
      using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in (
       'manual', 'test', 'onboarding', 'observed_peak', 'rhr_baseline',
       'maximal_effort', 'maximal_effort_estimate', 'cp_decrease_auto',
       'peak_expired', 'proposal_accepted', 'proposal_declined', 'revert',
       'lock', 'unlock') then
    raise exception 'save_my_cp: reason is not on the allow-list' using errcode = '22023';
  end if;
  if p_provenance is not null and pg_catalog.jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'save_my_cp: provenance must be a JSON object' using errcode = '22023';
  end if;

  -- A local date is at most one calendar day ahead of UTC.
  if p_valid_from is null
     or p_valid_from > ((pg_catalog.now() at time zone 'utc')::date + 1) then
    return pg_catalog.jsonb_build_object('status', 'bad_date', 'id', null,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  -- One save at a time per user and key, the same lock key text as 025.
  -- READ COMMITTED (PostgREST's default): a second save waits here, then
  -- reads the row the first one committed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rowing_cp:' || v_uid::text, 0));

  select * into v_live
    from public.anchors
   where user_id = v_uid and key = 'rowing_cp' and superseded_at is null;
  v_has_live := found;

  if p_expected_live_id is not null
     and (not v_has_live or v_live.id <> p_expected_live_id) then
    return pg_catalog.jsonb_build_object('status', 'stale',
      'id', case when v_has_live then v_live.id end,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  if v_has_live and v_live.locked
     and p_source in ('auto', 'estimate', 'observed') then
    return pg_catalog.jsonb_build_object('status', 'locked', 'id', v_live.id,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  if p_reason in ('lock', 'unlock') then
    -- A lock or unlock row carries the live value and the live valid_from.
    if not v_has_live then
      return pg_catalog.jsonb_build_object('status', 'unchanged', 'id', null,
        'replaced', false, 'valid_from', null, 'clamped', false);
    end if;
    v_value  := v_live.value;
    v_unit   := v_live.unit;
    v_status := v_live.status;
    v_source := v_live.source;
    v_valid  := v_live.valid_from;
    v_locked := (p_reason = 'lock');
  else
    v_value  := p_watts::text;
    v_unit   := 'W';
    v_status := p_status;
    v_source := p_source;
    v_valid  := p_valid_from;
    if v_has_live and p_valid_from < v_live.valid_from then
      v_valid   := v_live.valid_from;
      v_clamped := true;
    end if;
    v_locked := coalesce(p_locked, case when v_has_live then v_live.locked else false end);
  end if;

  if v_has_live
     and v_live.value = v_value
     and v_live.status is not distinct from v_status
     and v_live.source is not distinct from v_source
     and v_live.reason is not distinct from p_reason
     and v_live.valid_from = v_valid
     and v_live.locked = v_locked then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'id', v_live.id,
      'replaced', false, 'valid_from', v_live.valid_from, 'clamped', false);
  end if;

  -- One clock reading, after the lock, stamps both the retirement and the
  -- new row (as 025 does).
  v_now := pg_catalog.clock_timestamp();

  if v_has_live then
    update public.anchors set superseded_at = v_now
     where id = v_live.id and user_id = v_uid and superseded_at is null;
  end if;

  insert into public.anchors (user_id, key, value, unit, status, source, valid_from,
                              reason, rule_id, rule_version, provenance, locked, created_at)
  values (v_uid, 'rowing_cp', v_value, v_unit, v_status, v_source, v_valid,
          p_reason, p_rule_id, p_rule_version, p_provenance, v_locked, v_now)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('status', 'saved', 'id', v_id,
    'replaced', v_has_live, 'valid_from', v_valid, 'clamped', v_clamped);
end;
$fn$;

revoke all on function public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)
  to authenticated;

comment on function public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean) is
  'Signed-in user: retire the live rowing_cp anchor and insert the new one (W, 50-500) with its source, status, reason, rule and provenance, in one step (#819 S4). Runs as the caller under anchors RLS. Never deletes. Returns {status, id, replaced, valid_from, clamped}: saved, stale, locked, unchanged or bad_date.';

-- ---------------------------------------------------------------------------
-- save_my_hr_anchor: the max_hr and resting_hr writer, as the caller. The same
-- contract as save_my_cp; bounds max HR 120-220, resting HR 30-100 bpm.
-- ---------------------------------------------------------------------------
create function public.save_my_hr_anchor(
  p_key              text,
  p_bpm              integer,
  p_source           text,
  p_status           text,
  p_reason           text,
  p_valid_from       date,
  p_rule_id          text,
  p_rule_version     integer,
  p_provenance       jsonb,
  p_expected_live_id uuid default null,
  p_locked           boolean default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_has_live boolean;
  v_live     public.anchors%rowtype;
  v_value    text;
  v_unit     text;
  v_status   text;
  v_source   text;
  v_valid    date;
  v_locked   boolean;
  v_clamped  boolean := false;
  v_now      timestamptz;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'save_my_hr_anchor: not signed in' using errcode = '28000';
  end if;
  if p_key is null or p_key not in ('max_hr', 'resting_hr') then
    raise exception 'save_my_hr_anchor: key must be max_hr or resting_hr' using errcode = '22023';
  end if;
  if p_bpm is null
     or (p_key = 'max_hr' and (p_bpm < 120 or p_bpm > 220))
     or (p_key = 'resting_hr' and (p_bpm < 30 or p_bpm > 100)) then
    raise exception 'save_my_hr_anchor: heart rate is outside the range for this key'
      using errcode = '22023';
  end if;
  if p_source is null
     or p_source not in ('test', 'manual', 'observed', 'estimate', 'auto', 'onboarding') then
    raise exception 'save_my_hr_anchor: source is not one the app writes' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('provisional', 'unvalidated', 'confirmed') then
    raise exception 'save_my_hr_anchor: status must be provisional, unvalidated or confirmed'
      using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in (
       'manual', 'test', 'onboarding', 'observed_peak', 'rhr_baseline',
       'maximal_effort', 'maximal_effort_estimate', 'cp_decrease_auto',
       'peak_expired', 'proposal_accepted', 'proposal_declined', 'revert',
       'lock', 'unlock') then
    raise exception 'save_my_hr_anchor: reason is not on the allow-list' using errcode = '22023';
  end if;
  if p_provenance is not null and pg_catalog.jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'save_my_hr_anchor: provenance must be a JSON object' using errcode = '22023';
  end if;

  if p_valid_from is null
     or p_valid_from > ((pg_catalog.now() at time zone 'utc')::date + 1) then
    return pg_catalog.jsonb_build_object('status', 'bad_date', 'id', null,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_key || ':' || v_uid::text, 0));

  select * into v_live
    from public.anchors
   where user_id = v_uid and key = p_key and superseded_at is null;
  v_has_live := found;

  if p_expected_live_id is not null
     and (not v_has_live or v_live.id <> p_expected_live_id) then
    return pg_catalog.jsonb_build_object('status', 'stale',
      'id', case when v_has_live then v_live.id end,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  if v_has_live and v_live.locked
     and p_source in ('auto', 'estimate', 'observed') then
    return pg_catalog.jsonb_build_object('status', 'locked', 'id', v_live.id,
      'replaced', false, 'valid_from', null, 'clamped', false);
  end if;

  if p_reason in ('lock', 'unlock') then
    if not v_has_live then
      return pg_catalog.jsonb_build_object('status', 'unchanged', 'id', null,
        'replaced', false, 'valid_from', null, 'clamped', false);
    end if;
    v_value  := v_live.value;
    v_unit   := v_live.unit;
    v_status := v_live.status;
    v_source := v_live.source;
    v_valid  := v_live.valid_from;
    v_locked := (p_reason = 'lock');
  else
    v_value  := p_bpm::text;
    v_unit   := 'bpm';
    v_status := p_status;
    v_source := p_source;
    v_valid  := p_valid_from;
    if v_has_live and p_valid_from < v_live.valid_from then
      v_valid   := v_live.valid_from;
      v_clamped := true;
    end if;
    v_locked := coalesce(p_locked, case when v_has_live then v_live.locked else false end);
  end if;

  if v_has_live
     and v_live.value = v_value
     and v_live.status is not distinct from v_status
     and v_live.source is not distinct from v_source
     and v_live.reason is not distinct from p_reason
     and v_live.valid_from = v_valid
     and v_live.locked = v_locked then
    return pg_catalog.jsonb_build_object('status', 'unchanged', 'id', v_live.id,
      'replaced', false, 'valid_from', v_live.valid_from, 'clamped', false);
  end if;

  v_now := pg_catalog.clock_timestamp();

  if v_has_live then
    update public.anchors set superseded_at = v_now
     where id = v_live.id and user_id = v_uid and superseded_at is null;
  end if;

  insert into public.anchors (user_id, key, value, unit, status, source, valid_from,
                              reason, rule_id, rule_version, provenance, locked, created_at)
  values (v_uid, p_key, v_value, v_unit, v_status, v_source, v_valid,
          p_reason, p_rule_id, p_rule_version, p_provenance, v_locked, v_now)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('status', 'saved', 'id', v_id,
    'replaced', v_has_live, 'valid_from', v_valid, 'clamped', v_clamped);
end;
$fn$;

revoke all on function public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)
  to authenticated;

comment on function public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean) is
  'Signed-in user: retire the live max_hr (120-220) or resting_hr (30-100) anchor and insert the new one (bpm) with its source, status, reason, rule and provenance, in one step (#819 S4). Runs as the caller under anchors RLS. Never deletes. Same return shape as save_my_cp.';

-- ---------------------------------------------------------------------------
-- Self-test. Runs on apply with synthetic users and rolls itself back
-- (sentinel SQLSTATE 'SF028', the pattern 019, 020 and 023 to 027 use). A
-- failed check aborts the whole migration. Invented values only.
-- Every check reads in its own statement, after the call it checks: a count in
-- the same expression as the call cannot see the call's own write (027's first
-- apply). web/scripts/__tests__/self-test-call-and-count.test.mjs guards that.
-- ---------------------------------------------------------------------------
do $$
declare
  ua constant uuid := 'f0280000-0000-4000-8000-00000000000a';
  ub constant uuid := 'f0280000-0000-4000-8000-00000000000b';
  v_today  constant date := (now() at time zone 'utc')::date;
  v_future constant date := (now() at time zone 'utc')::date + 2;
  r jsonb;
  n integer;
  v_first uuid;
  v_live  uuid;
  v_b     uuid;
begin
  begin
    insert into auth.users (id) values (ua), (ub);
    insert into public.anchors (user_id, key, value, unit, status, source)
    values (ub, 'rowing_cp', '300', 'W', 'confirmed', 'manual');
    select id into v_b from public.anchors where user_id = ub and key = 'rowing_cp';

    perform pg_catalog.set_config('request.jwt.claim.sub', ua::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- s1: the first save, with no live row and no lower clamp.
    r := public.save_my_cp(210, 'manual', 'unvalidated', 'manual', v_today - 30,
                           null, null, null, null, null);
    if r->>'status' <> 'saved' or (r->>'replaced')::boolean or (r->>'clamped')::boolean
       or (r->>'valid_from')::date <> v_today - 30 then
      raise exception '028 self-test s1: first save reported %', r->>'status';
    end if;
    v_first := (r->>'id')::uuid;

    -- s2 (H 34): retire and insert in one step, W, history kept, one stamp.
    r := public.save_my_cp(215, 'manual', 'unvalidated', 'manual', v_today - 10,
                           null, null, null, v_first, null);
    if r->>'status' <> 'saved' or not (r->>'replaced')::boolean then
      raise exception '028 self-test s2: second save reported %', r->>'status';
    end if;
    v_live := (r->>'id')::uuid;
    select count(*) into n from public.anchors
     where user_id = ua and key = 'rowing_cp' and superseded_at is null
       and id = v_live and value = '215' and unit = 'W' and status = 'unvalidated'
       and source = 'manual' and reason = 'manual' and not locked;
    if n <> 1 then
      raise exception '028 self-test s2: the new live row is wrong';
    end if;
    select count(*) into n from public.anchors where user_id = ua and key = 'rowing_cp';
    if n <> 2 then
      raise exception '028 self-test s2: history was not kept';
    end if;
    if (select superseded_at from public.anchors where id = v_first)
       is distinct from (select created_at from public.anchors where id = v_live) then
      raise exception '028 self-test s2: hand-off stamp differs';
    end if;

    -- s3 (H 34 clamp): a backdated save is stored at the live valid_from.
    r := public.save_my_cp(220, 'manual', 'unvalidated', 'manual', v_today - 60,
                           null, null, null, v_live, null);
    if r->>'status' <> 'saved' or not (r->>'clamped')::boolean
       or (r->>'valid_from')::date <> v_today - 10 then
      raise exception '028 self-test s3: backdated save was not clamped';
    end if;
    v_live := (r->>'id')::uuid;

    -- s4 (H 34 clamp): a future date and a null date are refused, nothing written.
    r := public.save_my_cp(225, 'manual', 'unvalidated', 'manual', v_future,
                           null, null, null, null, null);
    if r->>'status' <> 'bad_date' then
      raise exception '028 self-test s4: future date reported %', r->>'status';
    end if;
    r := public.save_my_cp(225, 'manual', 'unvalidated', 'manual', null,
                           null, null, null, null, null);
    if r->>'status' <> 'bad_date' then
      raise exception '028 self-test s4: null date reported %', r->>'status';
    end if;
    select count(*) into n from public.anchors where user_id = ua and key = 'rowing_cp';
    if n <> 3 then
      raise exception '028 self-test s4: a refused date wrote a row';
    end if;

    -- s5 (A 32): a stale expected id writes nothing; a repeat is unchanged.
    r := public.save_my_cp(230, 'manual', 'unvalidated', 'manual', v_today,
                           null, null, null, v_first, null);
    if r->>'status' <> 'stale' then
      raise exception '028 self-test s5: stale id reported %', r->>'status';
    end if;
    r := public.save_my_cp(220, 'manual', 'unvalidated', 'manual', v_today - 10,
                           null, null, null, v_live, null);
    if r->>'status' <> 'unchanged' or (r->>'id')::uuid <> v_live then
      raise exception '028 self-test s5: repeat save reported %', r->>'status';
    end if;
    select count(*) into n from public.anchors where user_id = ua and key = 'rowing_cp';
    if n <> 3 then
      raise exception '028 self-test s5: stale or repeat wrote a row';
    end if;

    -- s6 (A 50, A 40): lock is a new row with the live value and date (the
    -- watts passed are ignored);
    -- a rule source is then refused; a manual save keeps the lock; unlock.
    r := public.save_my_cp(250, 'manual', 'unvalidated', 'lock', v_today,
                           null, null, null, v_live, null);
    if r->>'status' <> 'saved' or (r->>'valid_from')::date <> v_today - 10 then
      raise exception '028 self-test s6: lock reported %', r->>'status';
    end if;
    v_live := (r->>'id')::uuid;
    select count(*) into n from public.anchors
     where id = v_live and locked and value = '220' and reason = 'lock' and superseded_at is null;
    if n <> 1 then
      raise exception '028 self-test s6: the lock row is wrong';
    end if;
    r := public.save_my_cp(240, 'auto', 'provisional', 'maximal_effort', v_today,
                           'cp_fit', 1, '{"sessions": [1]}'::jsonb, v_live, null);
    if r->>'status' <> 'locked' then
      raise exception '028 self-test s6: a rule source replaced a locked row (%)', r->>'status';
    end if;
    r := public.save_my_cp(235, 'test', 'confirmed', 'test', v_today,
                           null, null, '{"protocol": "2k_6k"}'::jsonb, v_live, null);
    if r->>'status' <> 'saved' then
      raise exception '028 self-test s6: a test save under lock reported %', r->>'status';
    end if;
    v_live := (r->>'id')::uuid;
    select count(*) into n from public.anchors where id = v_live and locked;
    if n <> 1 then
      raise exception '028 self-test s6: a test save dropped the lock';
    end if;
    r := public.save_my_cp(260, 'manual', 'confirmed', 'unlock', v_today,
                           null, null, null, v_live, null);
    if r->>'status' <> 'saved' then
      raise exception '028 self-test s6: unlock reported %', r->>'status';
    end if;
    v_live := (r->>'id')::uuid;
    select count(*) into n from public.anchors
     where id = v_live and not locked and value = '235' and source = 'test';
    if n <> 1 then
      raise exception '028 self-test s6: the unlock row is wrong';
    end if;
    select count(*) into n from public.anchors where user_id = ua and key = 'rowing_cp';
    if n <> 6 then
      raise exception '028 self-test s6: expected six rowing_cp rows';
    end if;

    -- s7 (A 41): refused inputs raise 22023 and change nothing.
    begin
      perform public.save_my_cp(250, 'manual', 'unvalidated', 'age_estimate', v_today,
                                null, null, null, null, null);
      raise exception '028 self-test s7: age_estimate was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_my_cp(250, 'tester', 'unvalidated', 'manual', v_today,
                                null, null, null, null, null);
      raise exception '028 self-test s7: an unknown source was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_my_cp(501, 'manual', 'unvalidated', 'manual', v_today,
                                null, null, null, null, null);
      raise exception '028 self-test s7: 501 W was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_my_cp(250, 'manual', 'unvalidated', 'manual', v_today,
                                null, null, '[1]'::jsonb, null, null);
      raise exception '028 self-test s7: an array provenance was accepted';
    exception when sqlstate '22023' then null;
    end;
    select count(*) into n from public.anchors where user_id = ua and key = 'rowing_cp';
    if n <> 6 then
      raise exception '028 self-test s7: a refused input wrote a row';
    end if;

    -- s8: the HR writer, its bounds and its own key.
    r := public.save_my_hr_anchor('max_hr', 182, 'estimate', 'provisional', 'onboarding',
                                  v_today, 'nes', 1, '{"method": "nes"}'::jsonb, null, null);
    if r->>'status' <> 'saved' then
      raise exception '028 self-test s8: max_hr save reported %', r->>'status';
    end if;
    r := public.save_my_hr_anchor('resting_hr', 55, 'manual', 'unvalidated', 'manual',
                                  v_today, null, null, null, null, null);
    if r->>'status' <> 'saved' then
      raise exception '028 self-test s8: resting_hr save reported %', r->>'status';
    end if;
    select count(*) into n from public.anchors
     where user_id = ua and key in ('max_hr', 'resting_hr') and unit = 'bpm' and superseded_at is null;
    if n <> 2 then
      raise exception '028 self-test s8: HR rows are wrong';
    end if;
    begin
      perform public.save_my_hr_anchor('resting_hr', 101, 'manual', 'unvalidated', 'manual',
                                       v_today, null, null, null, null, null);
      raise exception '028 self-test s8: resting HR 101 was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_my_hr_anchor('max_hr', 221, 'manual', 'unvalidated', 'manual',
                                       v_today, null, null, null, null, null);
      raise exception '028 self-test s8: max HR 221 was accepted';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_my_hr_anchor('rowing_cp', 150, 'manual', 'unvalidated', 'manual',
                                       v_today, null, null, null, null, null);
      raise exception '028 self-test s8: the HR writer accepted rowing_cp';
    exception when sqlstate '22023' then null;
    end;

    -- s9 (H 41): owner only. A cannot see B; B is untouched.
    select count(*) into n from public.anchors where user_id = ub;
    if n <> 0 then
      raise exception '028 self-test s9: RLS let one user see another''s anchors';
    end if;

    -- s9: signed out is refused, anon cannot execute.
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    begin
      perform public.save_my_cp(200, 'manual', 'unvalidated', 'manual', v_today,
                                null, null, null, null, null);
      raise exception '028 self-test s9: a signed-out caller was not refused';
    exception when sqlstate '28000' then null;
    end;
    reset role;
    set local role anon;
    begin
      perform public.save_my_cp(200, 'manual', 'unvalidated', 'manual', v_today,
                                null, null, null, null, null);
      raise exception '028 self-test s9: anon was allowed to call save_my_cp';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.save_my_hr_anchor('max_hr', 180, 'manual', 'unvalidated', 'manual',
                                       v_today, null, null, null, null, null);
      raise exception '028 self-test s9: anon was allowed to call save_my_hr_anchor';
    exception when insufficient_privilege then null;
    end;
    reset role;
    select count(*) into n from public.anchors
     where user_id = ub and id = v_b and value = '300' and superseded_at is null;
    if n <> 1 then
      raise exception '028 self-test s9: the other user''s row changed';
    end if;
    select count(*) into n from public.anchors where user_id = ub;
    if n <> 1 then
      raise exception '028 self-test s9: the other user gained rows';
    end if;

    raise exception using errcode = 'SF028', message = 'rollback synthetic rows';
  exception when sqlstate 'SF028' then
    null;
  end;

  -- Catalogue checks.
  if has_function_privilege('anon', 'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute')
     or has_function_privilege('service_role', 'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute')
     or has_function_privilege('service_role', 'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)', 'execute') then
    raise exception '028 self-test: a 028 function has the wrong EXECUTE grants';
  end if;
  if (select count(*) from pg_catalog.pg_proc
       where oid in ('public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)'::regprocedure,
                     'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)'::regprocedure)
         and not prosecdef
         and proconfig @> array['search_path=""']) <> 2 then
    raise exception '028 self-test: a 028 function must be SECURITY INVOKER with an empty search_path';
  end if;
  -- 028 leaves 025 alone (decision 11). 025 is on dev only, so its absence
  -- elsewhere is a note, not a failure.
  if to_regprocedure('public.set_my_rowing_cp(integer)') is null then
    raise notice '028 self-test: set_my_rowing_cp is not on this project (025 is dev only)';
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'anchors') <> 1 then
    raise exception '028 self-test: anchors must still have exactly one policy';
  end if;
  if to_regclass('public.anchors_history') is null then
    raise exception '028 self-test: anchors_history index is missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
