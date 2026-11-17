-- Rollback for 012_strava_integration.sql. NOT auto-applied.
--
-- UNDEPLOY THE EDGE FUNCTIONS FIRST. strava-connect, strava-oauth-callback,
-- strava-import and strava-sync all call these tables and RPCs. Dropping them
-- while the functions are live turns the cron into a nightly Sentry issue and
-- turns the Connect button into an opaque 500. Run
--   supabase functions delete strava-import strava-sync strava-connect strava-oauth-callback
-- (or at minimum disable the cron job) before this.
--
-- DEAUTHORIZE AT STRAVA BEFORE DROPPING strava_tokens. Deleting the row does
-- not revoke the grant on Strava's side — it only destroys our copy of the
-- refresh token, leaving an app authorisation on the athlete's Strava account
-- that nothing can now revoke programmatically. Either hit disconnect in the
-- app first, or revoke manually at https://www.strava.com/settings/apps.
--
-- DATA LOSS:
--   * strava_sync_state carries backfill_cursor_before, incremental_after and
--     ambiguous_activity_ids. Dropping it discards the record of which
--     activities the adoption pass refused to guess on.
--   * strava_session_links is the ONLY record of which linked sessions the
--     importer created versus adopted, and of the avg_watts / avg_hr the
--     athlete had before an adoption overwrote them. Once it is gone, an
--     adopted row's original figures cannot be recovered and an imported row
--     cannot be told from a hand-filed one by anything but sessions.source
--     (which six legacy rows also carry). Undo the import (#630's disconnect
--     path) BEFORE rolling back, or export the links first. Exporting returns
--     Strava-derived data, so the owner runs and reads it, not an agent.
--
-- ORDER:
--   * 018 first. Its view public.sessions_no_strava depends on
--     strava_session_links, so this file refuses to run while the view exists.
--     Run 018's rollback and this one IN ONE TRANSACTION: 018's rollback alone
--     puts the strava_* tables back into the nightly backup, and committing
--     between the two leaves the credentials exportable until this one runs.
--   * The functions go before the tables they reference.
--   * 011's rollback after this one, never before.

DO $$
BEGIN
  IF to_regclass('public.sessions_no_strava') IS NOT NULL THEN
    RAISE EXCEPTION '012 ROLLBACK: public.sessions_no_strava (018) still exists; run 018_strava_backup_exclusion_rollback.sql first, in the same transaction';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.adopt_strava_session(uuid,bigint,bigint,int,boolean,int,text);
DROP FUNCTION IF EXISTS public.upsert_strava_session(uuid,bigint,text,text,text,text,int,int,int,text);

DROP POLICY IF EXISTS strava_sync_state_owner_select ON public.strava_sync_state;

DROP TABLE IF EXISTS public.strava_session_links;
DROP TABLE IF EXISTS public.strava_sync_state;
DROP TABLE IF EXISTS public.strava_oauth_state;
DROP TABLE IF EXISTS public.strava_tokens;
