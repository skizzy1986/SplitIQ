-- 021_sessions_duration_min.sql
-- DRAFT — not applied. Additive + reversible (#216).
-- duration stays the write column. duration_min is generated, read-only.
-- Do not apply until Scott gives an explicit yes to run this migration.

CREATE OR REPLACE FUNCTION public.session_duration_to_minutes(d text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  s text;
  m text[];
BEGIN
  s := lower(btrim(d));
  IF s = '' THEN
    RETURN NULL;
  END IF;

  -- hh:mm:ss before mm:ss — "1:02:03" is 62 + 3/60, not a failed mm:ss.
  m := regexp_match(s, '^(\d+):(\d{2}):(\d{2})$');
  IF m IS NOT NULL THEN
    RETURN m[1]::numeric * 60 + m[2]::numeric + m[3]::numeric / 60;
  END IF;

  -- mm:ss — "45:00", "90:00", "44:56", "120:00"
  m := regexp_match(s, '^(\d+):(\d{2})$');
  IF m IS NOT NULL THEN
    RETURN m[1]::numeric + m[2]::numeric / 60;
  END IF;

  -- hours + optional minutes — "1h4m", "2h00m", "1h"
  m := regexp_match(s, '^(\d+)h(\d+)?m?$');
  IF m IS NOT NULL THEN
    RETURN m[1]::numeric * 60 + COALESCE(m[2]::numeric, 0);
  END IF;

  -- minutes with suffix — "57m", "9min", "60min", "57.5m"
  m := regexp_match(s, '^(\d+(?:\.\d+)?)\s*(?:m|min)$');
  IF m IS NOT NULL THEN
    RETURN m[1]::numeric;
  END IF;

  -- bare numeric — "45"
  IF s ~ '^\d+(?:\.\d+)?$' THEN
    RETURN s::numeric;
  END IF;

  RETURN NULL;
EXCEPTION
  WHEN others THEN RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.session_duration_to_minutes(text) IS
  'IMMUTABLE parser for sessions.duration text. Returns minutes, or NULL if '
  'empty or unparseable — never 0 for a failed parse. Do NOT CREATE OR REPLACE '
  'this in place: sessions.duration_min is a STORED generated column and '
  'Postgres does not recompute stored values when a function body changes. '
  'To change it, recreate sessions_no_strava without duration_min, drop the '
  'column, replace the function, and re-add both.';

GRANT EXECUTE ON FUNCTION public.session_duration_to_minutes(text)
  TO anon, authenticated, service_role;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS duration_min numeric
  GENERATED ALWAYS AS (public.session_duration_to_minutes(duration)) STORED;

COMMENT ON COLUMN public.sessions.duration_min IS
  'Derived from sessions.duration (text). READ-ONLY — write `duration`; an '
  'INSERT naming duration_min is rejected by Postgres. NULL means missing or '
  'unparseable, not a zero-minute session.';

-- duration_min is appended at the end so CREATE OR REPLACE VIEW stays valid.
CREATE OR REPLACE VIEW public.sessions_no_strava
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.date,
  s.type,
  s.label,
  s.duration,
  s.srpe,
  s.prs,
  s.exercises,
  s.coach_note,
  s.created_at,
  s.status,
  s.coach_flag,
  CASE WHEN l.wrote_avg_watts THEN l.prior_avg_watts ELSE s.avg_watts END AS avg_watts,
  CASE WHEN l.wrote_avg_hr    THEN l.prior_avg_hr    ELSE s.avg_hr    END AS avg_hr,
  s.distance_m,
  s.user_id,
  s.source,
  s.date_iso,
  s.benchmark_key,
  s.duration_min
FROM public.sessions s
LEFT JOIN public.strava_session_links l ON l.session_id = s.id
WHERE l.origin IS DISTINCT FROM 'inserted'
  AND (l.session_id IS NOT NULL OR s.strava_activity_id IS NULL);

REVOKE ALL ON public.sessions_no_strava FROM public, anon, authenticated;

COMMENT ON VIEW public.sessions_no_strava IS
  'sessions without Strava data, for AI agent sessions (Strava API Policy '
  '§5.3; #631). Hides importer-inserted rows and any linked row without '
  'provenance; on adopted rows avg_watts / avg_hr show the athlete''s prior '
  'values where the importer wrote them; strava_activity_id is omitted. '
  'Includes duration_min (#216). security_invoker, so the caller''s own '
  'privileges apply. A convention for agent sessions, not a boundary.';

-- Literal fixtures only. No reads from sessions or Strava tables.
DO $$
BEGIN
  IF public.session_duration_to_minutes('45:00') IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION '021: 45:00 should be 45';
  END IF;
  IF public.session_duration_to_minutes('1h4m') IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION '021: 1h4m should be 64';
  END IF;
  IF public.session_duration_to_minutes('57m') IS DISTINCT FROM 57 THEN
    RAISE EXCEPTION '021: 57m should be 57';
  END IF;
  IF public.session_duration_to_minutes('1h') IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION '021: 1h should be 60';
  END IF;
  IF public.session_duration_to_minutes('2h00m') IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION '021: 2h00m should be 120';
  END IF;
  IF public.session_duration_to_minutes('90:00') IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION '021: 90:00 should be 90';
  END IF;
  IF public.session_duration_to_minutes('50:08') IS DISTINCT FROM (50 + 8::numeric / 60) THEN
    RAISE EXCEPTION '021: 50:08 should be 50 + 8/60';
  END IF;
  IF public.session_duration_to_minutes('45') IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION '021: bare 45 should be 45';
  END IF;
  IF public.session_duration_to_minutes(' 57m ') IS DISTINCT FROM 57 THEN
    RAISE EXCEPTION '021: padded 57m should be 57';
  END IF;
  IF public.session_duration_to_minutes('60MIN') IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION '021: 60MIN should be 60';
  END IF;
  IF public.session_duration_to_minutes('') IS NOT NULL THEN
    RAISE EXCEPTION '021: empty string should be NULL';
  END IF;
  IF public.session_duration_to_minutes('garbage') IS NOT NULL THEN
    RAISE EXCEPTION '021: garbage should be NULL';
  END IF;
  IF public.session_duration_to_minutes('1:02:03') IS DISTINCT FROM (62 + 3::numeric / 60) THEN
    RAISE EXCEPTION '021: 1:02:03 should be 62 + 3/60';
  END IF;
  IF public.session_duration_to_minutes('120:00') IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION '021: 120:00 should stay mm:ss = 120';
  END IF;
  IF public.session_duration_to_minutes('12:00:00') IS DISTINCT FROM 720 THEN
    RAISE EXCEPTION '021: 12:00:00 should be 720';
  END IF;
  IF public.session_duration_to_minutes('~15m') IS NOT NULL THEN
    RAISE EXCEPTION '021: approximate minutes stay NULL until a call is made';
  END IF;
  IF public.session_duration_to_minutes('20-30min') IS NOT NULL THEN
    RAISE EXCEPTION '021: a minutes range stays NULL';
  END IF;
  IF public.session_duration_to_minutes(NULL) IS NOT NULL THEN
    RAISE EXCEPTION '021: STRICT NULL should be NULL';
  END IF;

  IF NOT (has_function_privilege('anon', 'public.session_duration_to_minutes(text)', 'execute')
      AND has_function_privilege('authenticated', 'public.session_duration_to_minutes(text)', 'execute')) THEN
    RAISE EXCEPTION '021: anon/authenticated lost EXECUTE — sessions inserts would fail';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.sessions_no_strava'::regclass
      AND c.relkind = 'v'
      AND c.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION '021: sessions_no_strava is not a security_invoker view';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.sessions_no_strava'::regclass
      AND attname = 'strava_activity_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '021: sessions_no_strava exposes strava_activity_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.sessions_no_strava'::regclass
      AND attname = 'duration_min' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '021: sessions_no_strava is missing duration_min';
  END IF;

  IF has_table_privilege('anon', 'public.sessions_no_strava', 'select')
     OR has_table_privilege('authenticated', 'public.sessions_no_strava', 'select') THEN
    RAISE EXCEPTION '021: a browser role can select sessions_no_strava';
  END IF;
END
$$;
