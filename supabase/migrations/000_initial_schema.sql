-- 000_initial_schema.sql
-- Initial schema for erg-dashboard. Additive and idempotent.
-- Reflects the columns the app already inserts at real insert sites.
--
-- MIRROR, not a tracked migration (manifest.json). The exercises block below
-- was corrected to the live shape in #435 and matches 018. The sessions block
-- is still NOT faithful to production: live sessions.id is bigint and live
-- sessions.date is text "M/D/YY". So a from-zero replay of this folder STILL
-- FAILS [reproduced 2026-11-15 in a local PGlite (Postgres 18.6) replay with
-- the auth schema stubbed; not run on a Supabase stack]:
--   007_strength_subsystem.sql:64  strength_workouts.session_id bigint
--                                  references sessions(id), which is uuid here
--                                  ("foreign key constraint ... cannot be
--                                  implemented");
--   008_sessions_date_iso.sql:53   session_date_to_iso(date) on a date column;
--                                  the function takes text and there is no
--                                  implicit date-to-text cast ("function ...
--                                  does not exist").

-- sessions: all workouts (erg, strength, cycling, rest)
CREATE TABLE IF NOT EXISTS sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  date        date not null,
  type        text not null,
  label       text,
  -- duration is kept as text on purpose: the app inserts an integer (minutes)
  -- in some places and a trimmed text string (or null) in others. Using text
  -- avoids silently dropping non-numeric values on insert.
  duration    text,
  srpe        numeric,
  exercises   jsonb default '[]'::jsonb,
  watts       numeric,
  hr          numeric,
  distance    numeric,
  status      text default 'logged',
  source      text,
  -- prs: StrengthLogger sends a value here (currently a count integer); typed
  -- as jsonb per the approved spec so it can hold structured PR data later.
  prs         jsonb,
  created_at  timestamptz default now()
);

-- vitals: daily health metrics
CREATE TABLE IF NOT EXISTS vitals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  date        date not null,
  rhr         numeric,
  hrv         numeric,
  sleep       numeric,
  bodyweight  numeric,
  created_at  timestamptz default now()
);

-- exercises: shared reference table for exercise definitions (no user_id).
-- Live shape (#435): text ids from free-exercise-db, as captured by 018. The
-- rows come from supabase/seed/exercises.sql, never from a migration.
CREATE TABLE IF NOT EXISTS exercises (
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
CREATE INDEX IF NOT EXISTS exercises_name_idx
  ON exercises USING gin (to_tsvector('english'::regconfig, name));
CREATE INDEX IF NOT EXISTS exercises_category_idx
  ON exercises USING btree (category);
CREATE INDEX IF NOT EXISTS exercises_equipment_idx
  ON exercises USING btree (equipment);

-- Defensive additive columns, in case the tables somehow pre-exist without them.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS prs jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE vitals   ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id);
