-- Rollback for 019_strava_purge.sql. NOT auto-applied.
--
-- WHAT IT COSTS. Without these functions there is NO sanctioned way to delete
-- Strava data: disconnect returns 502 (strava-connect calls
-- purge_strava_user), the revocation purge errors for every due athlete, and
-- the deletion sync errors on every pass. Strava's API Policy still requires
-- all three. So undeploy or disable the callers first — at minimum unschedule
-- the strava-import cron (`select cron.unschedule('strava-import');`) — and do
-- not leave a live Strava connection running on top of this rollback.
--
-- No data is touched: the five functions are dropped and nothing else. 012's
-- race guard (P0003) lives in 012's functions and is unaffected.
--
-- ORDER. Roll this back BEFORE 018's and 012's rollbacks. 012's rollback drops
-- the tables these functions read; plpgsql and plain SQL function bodies carry
-- no dependency on them, so nothing would stop that drop, and the functions
-- would be left behind, broken.
--
-- Run as postgres.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '019 ROLLBACK must run as postgres: current_user=%', current_user;
  END IF;
END $$;

-- The callers first, then what they call.
DROP FUNCTION IF EXISTS public.purge_strava_activities(uuid,bigint[],timestamptz,boolean);
DROP FUNCTION IF EXISTS public.strava_link_inventory(uuid);
DROP FUNCTION IF EXISTS public.purge_strava_user(uuid,text,boolean);
DROP FUNCTION IF EXISTS public.strava_unlink_sessions_internal(uuid,bigint[],boolean);
DROP FUNCTION IF EXISTS public.strava_session_has_athlete_data(integer,text,integer,jsonb,text,text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('strava_session_has_athlete_data', 'strava_unlink_sessions_internal',
                                  'purge_strava_user', 'strava_link_inventory', 'purge_strava_activities')) THEN
    RAISE EXCEPTION '019 ROLLBACK: a Strava purge function (or an overload of one) still exists';
  END IF;
  RAISE NOTICE '019 rollback: all five Strava purge functions dropped';
END $$;
