-- 022_sessions_unique_per_user.sql
-- DRAFT — not applied. Additive-then-swap, reversible (#790, from #682).
-- Do not apply to SplitIQ dev or production until Scott gives an explicit yes
-- for this file. Dev first, rehearsed; production can follow and is not a
-- tester blocker.
--
-- sessions had UNIQUE (date, label) across ALL users. With more than one account
-- two athletes logging the same label on the same date collided: the second
-- insert failed with 23505, and the live logger and the offline queue treat
-- 23505 as "already delivered", so that session was dropped silently.
--
-- This scopes the key to the owner: UNIQUE (user_id, date, label).
--   1. Add the per-user key. It is strictly weaker than the old key, so every
--      existing row already satisfies it and the add cannot fail on data.
--   2. Replace fn_sync_strength_session, the one SQL caller that names the old key
--      in ON CONFLICT (date, label). Without this step, dropping the old key
--      would make every completed strength workout fail with "no unique or
--      exclusion constraint matching the ON CONFLICT specification". The body
--      below is the live definition with that one clause changed; CREATE OR
--      REPLACE keeps its owner and its grants (service_role only).
--   3. Drop the global key.
-- One transaction: there is no moment when neither key exists.
--
-- Nothing else names sessions_date_label_key. The strava functions catch
-- unique_violation by condition, not by constraint name, so they are unchanged.
-- Their per-activity key is the partial index (user_id, strava_activity_id).

begin;

alter table public.sessions
  add constraint sessions_user_date_label_key unique (user_id, date, label);

-- fn_sync_strength_session: live definition, ON CONFLICT now (user_id, date, label)
CREATE OR REPLACE FUNCTION public.fn_sync_strength_session(w_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w            public.strength_workouts%rowtype;
  v_date_txt   text;
  v_duration   text;
  v_exercises  jsonb;
  v_prs        int;
  v_secs       numeric;
  v_sid        bigint;
begin
  select * into w from public.strength_workouts where id = w_id;
  if not found then return; end if;

  -- Not completed → remove any rollup row + unlink, then stop
  if w.status <> 'completed' then
    if w.session_id is not null then
      delete from public.sessions where id = w.session_id;
      update public.strength_workouts set session_id = null where id = w_id;
    end if;
    return;
  end if;

  v_date_txt := to_char(w.workout_date, 'FMMM') || '/' ||
                to_char(w.workout_date, 'FMDD') || '/' ||
                to_char(w.workout_date, 'YY');

  v_secs := extract(epoch from (coalesce(w.completed_at, now()) - coalesce(w.started_at, w.created_at)));
  if v_secs is null or v_secs <= 0 then
    v_duration := null;
  elsif v_secs >= 3600 then
    v_duration := floor(v_secs/3600) || 'h' || lpad(floor(mod(v_secs,3600)/60)::text,2,'0') || 'm';
  else
    v_duration := floor(v_secs/60) || 'm';
  end if;

  -- Per-exercise aggregates for this workout
  with agg as (
    select
      s.exercise_id,
      max(s.exercise_name)            as name,
      max(s.weight_kg)                as top_weight,
      sum(s.weight_kg * s.reps)       as volume,
      max(s.weight_kg * (1 + s.reps::numeric/30)) as e1rm,
      min(s.created_at)               as first_seen
    from public.strength_sets s
    where s.workout_id = w_id and s.is_warmup = false
      and s.weight_kg is not null and s.reps is not null
    group by s.exercise_id
  ),
  prior as (
    select m.exercise_id, max(m.e1rm_kg) as prev_best
    from public.strength_set_metrics m
    where m.user_id = w.user_id
      and m.workout_status = 'completed'
      and m.workout_id <> w_id
    group by m.exercise_id
  ),
  flagged as (
    select a.*, (a.e1rm > coalesce(p.prev_best, 0)) as is_pr
    from agg a left join prior p on p.exercise_id = a.exercise_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'name',   name,
      'weight', round(top_weight,1) || 'kg',
      'volume', to_char(round(volume,0), 'FM999G999G999') || 'kg',
      'e1rm',   round(e1rm,1) || 'kg',
      'pr',     is_pr
    ) order by first_seen), '[]'::jsonb),
    count(*) filter (where is_pr)
  into v_exercises, v_prs
  from flagged;

  -- Upsert the rollup session row (user_id, date, label), idempotent per user
  insert into public.sessions
    (date, type, label, duration, srpe, prs, exercises, status, user_id, source)
  values
    (v_date_txt, w.session_type, w.label, v_duration, w.srpe,
     coalesce(v_prs,0), v_exercises, 'actual', w.user_id, 'strength_logger')
  on conflict (user_id, date, label) do update set
    type      = excluded.type,
    duration  = excluded.duration,
    srpe      = excluded.srpe,
    prs       = excluded.prs,
    exercises = excluded.exercises,
    status    = 'actual',
    source    = 'strength_logger'
  returning id into v_sid;

  if w.session_id is distinct from v_sid then
    update public.strength_workouts set session_id = v_sid where id = w_id;
  end if;
end;
$function$;

alter table public.sessions
  drop constraint sessions_date_label_key;

-- Self-test, inside the transaction. Any failure rolls the whole file back.
do $$
declare
  v_old int;
  v_new int;
  v_inf int;
begin
  select count(*) into v_old from pg_constraint
    where conrelid = 'public.sessions'::regclass and conname = 'sessions_date_label_key';
  select count(*) into v_new from pg_constraint
    where conrelid = 'public.sessions'::regclass and conname = 'sessions_user_date_label_key'
      and contype = 'u';
  if v_old <> 0 or v_new <> 1 then
    raise exception '022 self-test: expected the global key gone and the per-user key present (old=%, new=%)', v_old, v_new;
  end if;

  select count(*) into v_inf from pg_proc
    where oid = 'public.fn_sync_strength_session(uuid)'::regprocedure
      and prosrc like '%on conflict (user_id, date, label) do update%'
      and prosrc not like '%on conflict (date, label)%';
  if v_inf <> 1 then
    raise exception '022 self-test: fn_sync_strength_session does not use the per-user key';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
