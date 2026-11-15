-- 018_exercises_and_strength_views.sql
-- Captures objects that exist in production with no faithful file (#435):
--   public.exercises as it is live (11 data columns + created_at, text id),
--   its three indexes, RLS and its one read policy; the security_invoker
--   option on public.strength_set_metrics (the view itself is created by 007
--   and only altered here); and the six views that had no file at all:
--   exercise_with_media, exercise_prs, exercise_last_performance,
--   exercise_progression, strength_volume_daily, exercise_media_gaps.
-- Source: read-only SELECTs on production, 2026-11-15 (Postgres 17.6):
-- information_schema/pg_attribute, pg_indexes, pg_policies, pg_class.reloptions
-- and pg_get_viewdef. View bodies are pg_get_viewdef verbatim, with table
-- references schema-qualified; each view keeps its live security_invoker
-- spelling (true or on).
--
-- Idempotent: on production this is a verified no-op. CREATE VIEW has no
-- IF NOT EXISTS, and CREATE OR REPLACE VIEW rewrites the view's query and its
-- WITH options even when nothing changed, so every view is created only when
-- to_regclass() says it is absent, and never replaced. RLS is enabled and the
-- policy created only when missing. Grants are NOT changed, so the capture
-- stays faithful (as 015).
--
-- Seed: the 873 exercises rows are NOT inserted here. They predate this file
-- in production; for a fresh database, run supabase/seed/exercises.sql after
-- the migrations (generated from the pinned upstream file; see NOTICE.md).
--
-- SHAPE GUARD: a skipped create cannot tell a matching object from a drifted
-- one, so the closing block asserts the exact shape of all 8 objects (columns
-- and types in order, primary key, RLS, policy, index names, relkind,
-- security_invoker) and raises on any mismatch. That turns "capture" into
-- "verified capture".
--
-- APPLY: Scott approves; Supabase MCP apply_migration with name exactly
-- `018_exercises_and_strength_views` (R18). Then its manifest.json entry flips
-- to `applied` with the new live version; the liveOnly rows stay.

-- ── public.exercises ────────────────────────────────────────────────────────
create table if not exists public.exercises (
  id                text not null,
  name              text not null,
  force             text,
  level             text,
  mechanic          text,
  equipment         text,
  primary_muscles   text[] default '{}'::text[],
  secondary_muscles text[] default '{}'::text[],
  instructions      text[] default '{}'::text[],
  category          text,
  images            text[] default '{}'::text[],
  created_at        timestamptz default now(),
  constraint exercises_pkey primary key (id)
);

create index if not exists exercises_name_idx
  on public.exercises using gin (to_tsvector('english'::regconfig, name));
create index if not exists exercises_category_idx
  on public.exercises using btree (category);
create index if not exists exercises_equipment_idx
  on public.exercises using btree (equipment);

do $$
begin
  if not (select relrowsecurity from pg_class
          where oid = 'public.exercises'::regclass) then
    alter table public.exercises enable row level security;
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'exercises'
                   and policyname = 'exercises_read') then
    create policy exercises_read on public.exercises
      for select to authenticated
      using (true);
  end if;
end $$;

-- ── strength_set_metrics: security_invoker only (007 owns the body) ─────────
-- Without it the invoker views below would read strength_sets through a
-- definer view, i.e. as its owner, bypassing owner-only RLS.
do $$
begin
  if to_regclass('public.strength_set_metrics') is null then
    raise exception '018: public.strength_set_metrics is missing; it is created by 007_strength_subsystem.sql';
  end if;

  if not exists (select 1
                 from pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as o(opt)
                 where c.oid = 'public.strength_set_metrics'::regclass
                   and o.opt ~* '^security_invoker=(true|on|yes|1)$') then
    alter view public.strength_set_metrics set (security_invoker = on);
  end if;
end $$;

-- ── The six live-only views, in dependency order ────────────────────────────
do $$
begin
  if to_regclass('public.exercise_with_media') is null then
    execute $view$
create view public.exercise_with_media with (security_invoker = true) as
 SELECT e.id,
    e.name,
    e.primary_muscles,
    e.secondary_muscles,
    e.equipment,
    e.category,
    COALESCE(m.media_tier, 'fallback'::text) AS media_tier,
    m.video_front_url,
    m.video_side_url,
    m.poster_front_url,
    m.poster_side_url,
    m.model_3d_key,
    e.images
   FROM (public.exercises e
     LEFT JOIN public.exercise_media m ON ((m.exercise_id = e.id)))
$view$;
  end if;

  if to_regclass('public.exercise_prs') is null then
    execute $view$
create view public.exercise_prs with (security_invoker = on) as
 SELECT user_id,
    exercise_id,
    max(exercise_name) AS exercise_name,
    max(e1rm_kg) AS best_e1rm_kg,
    max(weight_kg) AS heaviest_kg,
    max(volume_kg) AS best_set_volume_kg,
    count(*) AS logged_sets
   FROM public.strength_set_metrics
  WHERE (workout_status = 'completed'::text)
  GROUP BY user_id, exercise_id
$view$;
  end if;

  if to_regclass('public.exercise_last_performance') is null then
    execute $view$
create view public.exercise_last_performance with (security_invoker = true) as
 WITH last_wk AS (
         SELECT strength_set_metrics.user_id,
            strength_set_metrics.exercise_id,
            max(strength_set_metrics.workout_date) AS last_date
           FROM public.strength_set_metrics
          WHERE (strength_set_metrics.workout_status = 'completed'::text)
          GROUP BY strength_set_metrics.user_id, strength_set_metrics.exercise_id
        )
 SELECT m.user_id,
    m.exercise_id,
    m.exercise_name,
    m.workout_date,
    m.set_index,
    m.weight_kg,
    m.reps,
    m.rpe,
    m.e1rm_kg,
    m.volume_kg
   FROM (public.strength_set_metrics m
     JOIN last_wk l ON (((l.user_id = m.user_id) AND (l.exercise_id = m.exercise_id) AND (l.last_date = m.workout_date))))
  WHERE (m.workout_status = 'completed'::text)
$view$;
  end if;

  if to_regclass('public.exercise_progression') is null then
    execute $view$
create view public.exercise_progression with (security_invoker = true) as
 SELECT user_id,
    exercise_id,
    max(exercise_name) AS exercise_name,
    workout_date,
    max(e1rm_kg) AS top_e1rm_kg,
    max(weight_kg) AS top_weight_kg,
    sum(volume_kg) AS total_volume_kg,
    count(*) AS work_sets
   FROM public.strength_set_metrics
  WHERE (workout_status = 'completed'::text)
  GROUP BY user_id, exercise_id, workout_date
$view$;
  end if;

  if to_regclass('public.strength_volume_daily') is null then
    execute $view$
create view public.strength_volume_daily with (security_invoker = on) as
 SELECT user_id,
    workout_date,
    round(sum(volume_kg), 0) AS total_volume_kg,
    count(*) AS working_sets,
    count(DISTINCT exercise_id) AS exercises
   FROM public.strength_set_metrics
  WHERE ((workout_status = 'completed'::text) AND (volume_kg IS NOT NULL))
  GROUP BY user_id, workout_date
$view$;
  end if;

  if to_regclass('public.exercise_media_gaps') is null then
    execute $view$
create view public.exercise_media_gaps with (security_invoker = true) as
 SELECT DISTINCT e.id,
    e.name,
    e.primary_muscles,
    COALESCE(m.media_tier, 'fallback'::text) AS media_tier
   FROM ((public.template_exercises te
     JOIN public.exercises e ON ((e.id = te.exercise_id)))
     LEFT JOIN public.exercise_media m ON ((m.exercise_id = e.id)))
  WHERE (COALESCE(m.media_tier, 'fallback'::text) = 'fallback'::text)
  ORDER BY e.name
$view$;
  end if;
end $$;

-- ── SHAPE GUARD ─────────────────────────────────────────────────────────────
do $$
declare
  v_cols text[];
  r record;
begin
  -- exercises: columns and types in order, text primary key on id, RLS, the
  -- one live policy, the three live index names.
  if to_regclass('public.exercises') is null then
    raise exception '018: public.exercises is missing';
  end if;

  select array_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
                   order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.exercises'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from array[
       'id text', 'name text', 'force text', 'level text', 'mechanic text',
       'equipment text', 'primary_muscles text[]', 'secondary_muscles text[]',
       'instructions text[]', 'category text', 'images text[]',
       'created_at timestamp with time zone'] then
    raise exception '018: public.exercises has drifted from the captured shape (columns: %)', v_cols;
  end if;

  if not exists (select 1
                 from pg_index i
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                 where i.indrelid = 'public.exercises'::regclass
                   and i.indisprimary and i.indnatts = 1 and a.attname = 'id') then
    raise exception '018: public.exercises has drifted from the captured shape (primary key is not id)';
  end if;

  if not (select relrowsecurity from pg_class
          where oid = 'public.exercises'::regclass) then
    raise exception '018: public.exercises has drifted from the captured shape (RLS is off)';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'exercises') <> 1
     or not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'exercises'
                      and policyname = 'exercises_read' and cmd = 'SELECT'
                      and roles = '{authenticated}'::name[] and qual = 'true') then
    raise exception '018: public.exercises has drifted from the captured shape (expected exactly one policy, exercises_read: select to authenticated using (true))';
  end if;

  if (select count(*) from pg_indexes
      where schemaname = 'public' and tablename = 'exercises'
        and indexname in ('exercises_name_idx', 'exercises_category_idx',
                          'exercises_equipment_idx')) <> 3 then
    raise exception '018: public.exercises has drifted from the captured shape (missing one of exercises_name_idx, exercises_category_idx, exercises_equipment_idx)';
  end if;

  -- strength_set_metrics and the six views: a view, security_invoker set,
  -- columns and types in order.
  for r in
    select * from (values
      ('strength_set_metrics', array[
        'id uuid', 'user_id uuid', 'workout_id uuid', 'exercise_id text',
        'exercise_name text', 'set_index integer', 'weight_kg numeric',
        'reps integer', 'rpe numeric', 'is_warmup boolean', 'completed boolean',
        'created_at timestamp with time zone', 'workout_date date',
        'session_type text', 'workout_status text', 'volume_kg numeric',
        'e1rm_kg numeric']),
      ('exercise_with_media', array[
        'id text', 'name text', 'primary_muscles text[]',
        'secondary_muscles text[]', 'equipment text', 'category text',
        'media_tier text', 'video_front_url text', 'video_side_url text',
        'poster_front_url text', 'poster_side_url text', 'model_3d_key text',
        'images text[]']),
      ('exercise_prs', array[
        'user_id uuid', 'exercise_id text', 'exercise_name text',
        'best_e1rm_kg numeric', 'heaviest_kg numeric',
        'best_set_volume_kg numeric', 'logged_sets bigint']),
      ('exercise_last_performance', array[
        'user_id uuid', 'exercise_id text', 'exercise_name text',
        'workout_date date', 'set_index integer', 'weight_kg numeric',
        'reps integer', 'rpe numeric', 'e1rm_kg numeric', 'volume_kg numeric']),
      ('exercise_progression', array[
        'user_id uuid', 'exercise_id text', 'exercise_name text',
        'workout_date date', 'top_e1rm_kg numeric', 'top_weight_kg numeric',
        'total_volume_kg numeric', 'work_sets bigint']),
      ('strength_volume_daily', array[
        'user_id uuid', 'workout_date date', 'total_volume_kg numeric',
        'working_sets bigint', 'exercises bigint']),
      ('exercise_media_gaps', array[
        'id text', 'name text', 'primary_muscles text[]', 'media_tier text'])
    ) as t(view_name, cols)
  loop
    if (select c.relkind from pg_class c
        where c.oid = to_regclass('public.' || r.view_name)) is distinct from 'v' then
      raise exception '018: public.% has drifted from the captured shape (not a view)', r.view_name;
    end if;

    if not exists (select 1
                   from pg_class c, unnest(coalesce(c.reloptions, '{}'::text[])) as o(opt)
                   where c.oid = to_regclass('public.' || r.view_name)
                     and o.opt ~* '^security_invoker=(true|on|yes|1)$') then
      raise exception '018: public.% has drifted from the captured shape (security_invoker is not set)', r.view_name;
    end if;

    select array_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
                     order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = to_regclass('public.' || r.view_name)
       and a.attnum > 0 and not a.attisdropped;
    if v_cols is distinct from r.cols then
      raise exception '018: public.% has drifted from the captured shape (columns: %)', r.view_name, v_cols;
    end if;
  end loop;
end $$;
