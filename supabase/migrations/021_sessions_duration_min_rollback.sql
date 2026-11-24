-- Rollback for 021_sessions_duration_min.sql. NOT auto-applied.
-- Revert the Vercel deploy FIRST. A client selecting duration_min against a
-- schema without the column gets a PostgREST 400 on every sessions read.

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
  s.benchmark_key
FROM public.sessions s
LEFT JOIN public.strava_session_links l ON l.session_id = s.id
WHERE l.origin IS DISTINCT FROM 'inserted'
  AND (l.session_id IS NOT NULL OR s.strava_activity_id IS NULL);

REVOKE ALL ON public.sessions_no_strava FROM public, anon, authenticated;

ALTER TABLE public.sessions DROP COLUMN IF EXISTS duration_min;
DROP FUNCTION IF EXISTS public.session_duration_to_minutes(text);
