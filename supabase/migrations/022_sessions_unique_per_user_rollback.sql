-- Rollback for 022_sessions_unique_per_user.sql. NOT auto-applied.
--
-- Restores the global UNIQUE (date, label). That key cannot exist while two
-- accounts hold a session with the same date and label, which is exactly the
-- case 022 allows. So this file stops with a clear message instead of
-- failing half way. If it stops, nothing was changed; resolve the duplicates
-- on purpose (they are different people's rows) or keep 022.

begin;

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select 1 from public.sessions group by date, label having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '022 rollback refused: % (date, label) pairs exist on more than one row, so the global key cannot be restored', v_dupes;
  end if;
end $$;

alter table public.sessions
  add constraint sessions_date_label_key unique (date, label);

-- fn_sync_strength_session: live definition before 022, ON CONFLICT (date, label)
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

  -- Upsert the rollup session row (date,label) idempotent
  insert into public.sessions
    (date, type, label, duration, srpe, prs, exercises, status, user_id, source)
  values
    (v_date_txt, w.session_type, w.label, v_duration, w.srpe,
     coalesce(v_prs,0), v_exercises, 'actual', w.user_id, 'strength_logger')
  on conflict (date, label) do update set
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
  drop constraint sessions_user_date_label_key;

commit;

notify pgrst, 'reload schema';
