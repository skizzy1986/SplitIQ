-- 020_strava_activity_cache.sql
-- Additive + reversible (020_strava_activity_cache_rollback.sql). #647, slice
-- 1a of epic #646. Depends on 012 (strava_session_links), 018 (the backup
-- exclusion and sessions_no_strava) and 019 (the purges, which this file's
-- self-test calls).
--
-- WHAT THIS DOES:
--   1. Refuses to run unless as postgres, after 012 and 018, with pg_cron.
--   2. Re-creates backup_snapshot() with 018's body, changing ONE thing:
--      v_excluded gains strava_activity_cache. Done BEFORE the table exists,
--      so there is never a moment the table exists and is exported.
--      web/scripts/__tests__/strava-credential-backup.test.mjs finds this body
--      by its $function$ delimiter and fails CI if a later migration drops it.
--   3. Creates public.strava_activity_cache: the session page's copy of one
--      activity's Strava detail and streams, written and read only by the
--      strava-activity edge function (service_role).
--   4. Creates public.strava_activity_cache_sweep() and schedules it hourly
--      with pg_cron, so expiry needs nobody to open a session.
--   5. Self-tests on synthetic rows in a subtransaction that always rolls back
--      (sentinel SQLSTATE 'SF020', 019's pattern), then asserts grants, RLS,
--      policies, the snapshot and the cron job from the catalogue.
--
-- STRAVA API POLICY §6.2: "You may not retain Strava Data in your cache for
-- longer than seven (7) days" (strava.com/legal/api_policy). Rows live six
-- days (strava-activity sets expires_at = fetched_at + 6 days); the check
-- constraint refuses anything past seven; the sweep runs hourly, so the
-- worst-case retention is six days and one hour. The arithmetic is in HOURS
-- (144 and 168), not days: `timestamptz + interval 'N days'` adds calendar days
-- in the session TimeZone, which across a DST change is not N x 24 hours.
--
-- WHY THE FOREIGN KEY POINTS AT THE LINK ROW, NOT AT sessions: every purge
-- path in 019 either deletes the session (the link cascades from sessions,
-- 012) or deletes only the link and keeps the session (019's keep_unlink and
-- restore_unlink paths, strava_unlink_sessions_internal), so a cache row goes
-- with its link on disconnect, revocation and the deletion sync without any
-- edit to 019. The self-test runs both branches through both entry points.
--
-- PRIVACY: RLS enabled, NO policies, nothing granted to anon or authenticated,
-- never FORCED — the same model as strava_tokens (012's header explains why
-- FORCE would protect nothing and 017's self-test refuses it). service_role
-- keeps its access through Supabase's default privileges, exactly as 012's
-- tables do (012 grants nothing to service_role on a table).
--
-- THE CRON JOB runs as the role that scheduled it: postgres, the table owner,
-- which bypasses RLS. cron.schedule with an existing job name overwrites that
-- job, and cron.unschedule('name') removes it (supabase.com/docs/guides/cron/
-- quickstart). The sweep is executable by no API role.
--
-- APPLY THIS FILE INSIDE ONE TRANSACTION. It does not open one itself; the
-- #628 apply method wraps the file in begin/commit, and so must any other.
-- The reason: Supabase's default privileges grant anon and authenticated on a
-- new public table, so between CREATE TABLE and the REVOKE / ENABLE ROW LEVEL
-- SECURITY below the table is reachable by both. Inside one transaction no
-- other session ever sees that state. Under autocommit, a failure between
-- those statements would leave an empty table briefly reachable by the
-- browser roles. Inside one transaction, a failure anywhere rolls the whole
-- file back; the snapshot change is safe alone in any case (it excludes a
-- table that may not exist yet).
--
-- APPLY: Scott approves; a rolled-back trial first, then the apply by the
-- #628 method (CLI `db query --linked --file`), as postgres; then the
-- manifest entry flips to `applied` with the live version, and get_advisors
-- is re-run.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '020 must run as postgres (owner of backup_snapshot() and of the cron job): current_user=%', current_user;
  END IF;
  IF to_regclass('public.strava_session_links') IS NULL THEN
    RAISE EXCEPTION '020 needs 012_strava_integration applied first: public.strava_session_links does not exist';
  END IF;
  IF to_regclass('public.sessions_no_strava') IS NULL THEN
    RAISE EXCEPTION '020 needs 018_strava_backup_exclusion applied first: public.sessions_no_strava does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e WHERE e.extname = 'pg_cron') THEN
    RAISE EXCEPTION '020 needs the pg_cron extension: it is not installed';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. backup_snapshot() — 018's body, v_excluded + strava_activity_cache.
-- ---------------------------------------------------------------------------
create or replace function public.backup_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  -- Tables never exported. backup_snapshots would nest every earlier snapshot.
  -- The strava_* tables hold OAuth credentials and Strava sync state (018).
  -- Coverage relies on the owner bypassing RLS: never FORCE RLS on a public
  -- table (017's self-test refuses it), or that table exports only some rows.
  v_excluded constant text[] := array['backup_snapshots', 'strava_activity_cache', 'strava_oauth_state', 'strava_session_links', 'strava_sync_state', 'strava_tokens'];
  v_rel      text;
  v_count    bigint;
  v_rows     jsonb;
  v_counts   jsonb := '{}'::jsonb;
  v_tables   jsonb := '{}'::jsonb;
begin
  for v_rel in
    select c.relname::text
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relispartition
       and c.relname::text <> all (v_excluded)
     order by c.relname
  loop
    execute format(
      'select count(*), coalesce(jsonb_agg(t), ''[]''::jsonb) from public.%I t',
      v_rel
    ) into v_count, v_rows;
    v_counts := v_counts || jsonb_build_object(v_rel, v_count);
    v_tables := v_tables || jsonb_build_object(v_rel, v_rows);
  end loop;

  return jsonb_build_object(
    'schema_version', 2,
    'exported_at', now(),
    'excluded', to_jsonb(v_excluded),
    'counts', v_counts,
    'tables', v_tables
  );
end;
$function$;

revoke all on function public.backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;

-- ---------------------------------------------------------------------------
-- 2. strava_activity_cache — the only place Strava stream data may sit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strava_activity_cache (
  session_id         bigint PRIMARY KEY
                       REFERENCES public.strava_session_links(session_id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  strava_activity_id bigint NOT NULL,
  payload            jsonb NOT NULL,
  fetched_at         timestamptz NOT NULL DEFAULT now(),
  -- Hours, not days: see the header (DST).
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '144 hours'),
  CONSTRAINT strava_activity_cache_within_seven_days
    CHECK (expires_at > fetched_at AND expires_at <= fetched_at + interval '168 hours')
);

-- Enabled, no policies, no browser grants. Not FORCED: see the header.
ALTER TABLE public.strava_activity_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_activity_cache FROM public, anon, authenticated;

-- The sweep's range scan, and the not_connected path's per-user delete.
CREATE INDEX IF NOT EXISTS strava_activity_cache_expires_at_idx
  ON public.strava_activity_cache (expires_at);
CREATE INDEX IF NOT EXISTS strava_activity_cache_user_id_idx
  ON public.strava_activity_cache (user_id);

COMMENT ON TABLE public.strava_activity_cache IS
  'One linked session''s Strava activity detail and streams, normalised, for '
  'the session page (#647). Written and read only by the strava-activity edge '
  'function (service_role). DELIBERATELY POLICY-LESS: RLS enabled, no policies, '
  'nothing granted to anon or authenticated, never forced. Strava API Policy '
  '§6.2 allows Strava Data in a cache for at most seven days: rows expire six '
  'days after fetch (the check refuses more than seven) and '
  'strava_activity_cache_sweep() deletes expired rows hourly (pg_cron job '
  'strava-activity-cache-sweep). Cascades from strava_session_links, so every '
  'Strava purge path removes the row. Excluded from the nightly backup by 020. '
  'Strava-derived series never enter a permanent store.';

-- ---------------------------------------------------------------------------
-- 3. The sweep, and its hourly schedule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.strava_activity_cache_sweep()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM public.strava_activity_cache c
     WHERE c.expires_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE ALL ON FUNCTION public.strava_activity_cache_sweep()
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.strava_activity_cache_sweep() IS
  'Delete strava_activity_cache rows whose expires_at has passed; returns the '
  'count. Run hourly by the pg_cron job strava-activity-cache-sweep as postgres '
  '(#647). Executable by no API role.';

SELECT cron.schedule(
  'strava-activity-cache-sweep',
  '23 * * * *',
  $cron$select public.strava_activity_cache_sweep()$cron$
);

-- ---------------------------------------------------------------------------
-- Self-test. Synthetic data only, in a subtransaction that always ends in the
-- sentinel SQLSTATE 'SF020', so everything it writes rolls back (019's
-- pattern; plpgsql-control-structures.html § Trapping Errors, as 012 quotes).
-- Random user ids, labels carrying a random tag (sessions has a global
-- UNIQUE (date, label)), dates no real row is near, activity ids in a range no
-- real activity uses. No real row is read or printed. The sweep in (f) runs
-- over the whole table, so it is asserted against the count of rows already
-- expired (none on first apply) rather than a fixed 1.
--
-- Both of 019's removal branches are exercised through both entry points
-- (purge_strava_activities and purge_strava_user): an importer-inserted
-- session with no athlete data is DELETED (the link cascades from sessions,
-- the cache from the link), and one the athlete has annotated (srpe set, as
-- 019's own self-test does it) is KEPT with only its link deleted (keep_unlink:
-- the cache cascades from the link alone).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();  -- the athlete under test
  v_user2  uuid := gen_random_uuid();  -- another athlete
  v_tag    text := replace(gen_random_uuid()::text, '-', '');
  v_a      bigint;  -- user: no athlete data, deleted by purge_strava_activities
  v_g      bigint;  -- user: srpe set, kept and unlinked by purge_strava_activities
  v_c      bigint;  -- user: no athlete data, deleted by purge_strava_user
  v_h      bigint;  -- user: srpe set, kept and unlinked by purge_strava_user
  v_b      bigint;  -- user2: survives both purges
  v_d      bigint;  -- user2: deleted straight from sessions
  v_e      bigint;  -- user2: expired cache row, swept
  v_f      bigint;  -- user2: fresh cache row, kept by the sweep
  v_res    jsonb;
  v_n      integer;
  v_before integer;
  v_raised boolean;
BEGIN
  BEGIN
    -- ---- setup ------------------------------------------------------------
    -- Connected sync rows first: 012's race guard refuses to link without one.
    INSERT INTO public.strava_sync_state (user_id, connected, backfill_from)
    VALUES (v_user, true, DATE '2000-01-01'),
           (v_user2, true, DATE '2000-01-01');

    SELECT r.session_id INTO v_a FROM public.upsert_strava_session(v_user, 902000000001, '1/1/00', 'erg',
      'strava-020-selftest-A-' || v_tag, '25:00', 6000, 150, 130, 'Concept2 PM5') r;
    SELECT r.session_id INTO v_b FROM public.upsert_strava_session(v_user2, 902000000002, '1/1/00', 'erg',
      'strava-020-selftest-B-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_c FROM public.upsert_strava_session(v_user, 902000000003, '1/2/00', 'erg',
      'strava-020-selftest-C-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_d FROM public.upsert_strava_session(v_user2, 902000000004, '1/2/00', 'erg',
      'strava-020-selftest-D-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_e FROM public.upsert_strava_session(v_user2, 902000000005, '1/3/00', 'erg',
      'strava-020-selftest-E-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_f FROM public.upsert_strava_session(v_user2, 902000000006, '1/3/00', 'erg',
      'strava-020-selftest-F-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_g FROM public.upsert_strava_session(v_user, 902000000007, '1/4/00', 'erg',
      'strava-020-selftest-G-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    UPDATE public.sessions s SET srpe = 6 WHERE s.id = v_g;
    SELECT r.session_id INTO v_h FROM public.upsert_strava_session(v_user, 902000000008, '1/4/00', 'erg',
      'strava-020-selftest-H-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    UPDATE public.sessions s SET srpe = 6 WHERE s.id = v_h;
    -- A's and G's links are created at now() (the transaction start); the
    -- deletion sync in (c) cuts off at now() + 30 minutes so they fall before it.

    IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL OR v_d IS NULL OR v_e IS NULL OR v_f IS NULL
       OR v_g IS NULL OR v_h IS NULL
       OR (SELECT count(*) FROM public.strava_session_links l WHERE l.user_id IN (v_user, v_user2)) <> 8 THEN
      RAISE EXCEPTION '020 self-test: setup did not produce the expected links';
    END IF;

    -- ---- (a) a row inserts against a link; against no link raises 23503 -----
    INSERT INTO public.strava_activity_cache (session_id, user_id, strava_activity_id, payload)
    VALUES (v_a, v_user, 902000000001, '{"activity":{},"streams":{}}'::jsonb),
           (v_b, v_user2, 902000000002, '{}'::jsonb),
           (v_c, v_user, 902000000003, '{}'::jsonb),
           (v_d, v_user2, 902000000004, '{}'::jsonb),
           (v_f, v_user2, 902000000006, '{}'::jsonb),
           (v_g, v_user, 902000000007, '{}'::jsonb),
           (v_h, v_user, 902000000008, '{}'::jsonb);
    INSERT INTO public.strava_activity_cache (session_id, user_id, strava_activity_id, payload, fetched_at, expires_at)
    VALUES (v_e, v_user2, 902000000005, '{}'::jsonb, now() - interval '168 hours', now() - interval '24 hours');
    IF (SELECT count(*) FROM public.strava_activity_cache c WHERE c.user_id IN (v_user, v_user2)) <> 8
       OR (SELECT c.expires_at - c.fetched_at FROM public.strava_activity_cache c WHERE c.session_id = v_a)
          IS DISTINCT FROM interval '144 hours' THEN
      RAISE EXCEPTION '020 self-test: cache rows did not insert with the 144-hour default';
    END IF;

    v_raised := false;
    BEGIN
      INSERT INTO public.strava_activity_cache (session_id, user_id, strava_activity_id, payload)
      VALUES (-1, v_user, 902000000099, '{}'::jsonb);
    EXCEPTION WHEN SQLSTATE '23503' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '020 self-test: a cache row with no link did not raise 23503';
    END IF;

    -- ---- (b) the check refuses more than seven days ------------------------
    v_raised := false;
    BEGIN
      UPDATE public.strava_activity_cache c
         SET expires_at = c.fetched_at + interval '192 hours'
       WHERE c.session_id = v_a;
    EXCEPTION WHEN SQLSTATE '23514' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '020 self-test: expires_at = fetched_at + 192 hours did not raise 23514';
    END IF;
    v_raised := false;
    BEGIN
      UPDATE public.strava_activity_cache c
         SET expires_at = c.fetched_at
       WHERE c.session_id = v_a;
    EXCEPTION WHEN SQLSTATE '23514' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '020 self-test: expires_at = fetched_at did not raise 23514';
    END IF;

    -- ---- (c) the deletion sync: delete branch (A) and link-only branch (G) ---
    -- 902000000002 is user2's (B): not this user's, so not_found and kept.
    v_res := public.purge_strava_activities(v_user, ARRAY[902000000001, 902000000002, 902000000007]::bigint[],
      now() + interval '30 minutes', false);
    IF v_res->>'status' IS DISTINCT FROM 'purged'
       OR (v_res->>'deleted')::int <> 1 OR (v_res->>'kept')::int <> 1 THEN
      RAISE EXCEPTION '020 self-test: purge_strava_activities returned %', v_res;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_g)
       OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_g) THEN
      RAISE EXCEPTION '020 self-test: keep_unlink did not keep session G and delete only its link';
    END IF;
    IF EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id IN (v_a, v_g))
       OR NOT EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_b)
       OR NOT EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_c)
       OR NOT EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_h) THEN
      RAISE EXCEPTION '020 self-test: purge_strava_activities left the wrong cache rows';
    END IF;

    -- ---- (d) disconnect: delete branch (C) and link-only branch (H) ----------
    v_res := public.purge_strava_user(v_user, 'disconnect', false);
    IF v_res->>'status' IS DISTINCT FROM 'purged'
       OR (v_res->>'deleted')::int <> 1 OR (v_res->>'kept')::int <> 1 THEN
      RAISE EXCEPTION '020 self-test: purge_strava_user returned %', v_res;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_h) THEN
      RAISE EXCEPTION '020 self-test: keep_unlink did not keep session H';
    END IF;
    IF EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.user_id = v_user)
       OR (SELECT count(*) FROM public.strava_activity_cache c WHERE c.user_id = v_user2) <> 4 THEN
      RAISE EXCEPTION '020 self-test: purge_strava_user left a link or the wrong cache rows';
    END IF;

    -- ---- (e) deleting the session cascades to the cache ---------------------
    DELETE FROM public.sessions s WHERE s.id = v_d AND s.user_id = v_user2;
    IF EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_d) THEN
      RAISE EXCEPTION '020 self-test: a sessions delete did not cascade to the cache';
    END IF;

    -- ---- (f) the sweep deletes expired rows only ------------------------------
    SELECT count(*)::integer INTO v_before
      FROM public.strava_activity_cache c WHERE c.expires_at <= now();
    v_n := public.strava_activity_cache_sweep();
    IF v_n IS DISTINCT FROM v_before OR v_n < 1
       OR EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_e)
       OR NOT EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_f)
       OR NOT EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.session_id = v_b) THEN
      RAISE EXCEPTION '020 self-test: the sweep returned % (want %) or left the wrong rows', v_n, v_before;
    END IF;
    v_n := public.strava_activity_cache_sweep();
    IF v_n <> 0 THEN
      RAISE EXCEPTION '020 self-test: a second sweep deleted % rows', v_n;
    END IF;

    RAISE EXCEPTION 'rollback' USING ERRCODE = 'SF020';
  EXCEPTION WHEN SQLSTATE 'SF020' THEN
    NULL;  -- the sentinel: everything above is rolled back
  END;

  -- ---- (g) nothing synthetic survives -----------------------------------------
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id IN (v_user, v_user2))
     OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.user_id IN (v_user, v_user2))
     OR EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id IN (v_user, v_user2))
     OR EXISTS (SELECT 1 FROM public.strava_activity_cache c WHERE c.user_id IN (v_user, v_user2)) THEN
    RAISE EXCEPTION '020 self-test: synthetic rows survived the rollback';
  END IF;

  RAISE NOTICE '020: cache self-test passed (link FK, 168-hour check, deletion-sync and disconnect purges each through the delete and the link-only keep_unlink branch, sessions cascade, sweep); all synthetic rows rolled back';
END $$;

-- ---------------------------------------------------------------------------
-- Assertions, from the catalogue. backup_snapshot() is called as 018 calls it
-- and only its keys and `excluded` array are read — no row content.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_excluded constant text[] := array['backup_snapshots', 'strava_activity_cache', 'strava_oauth_state', 'strava_session_links', 'strava_sync_state', 'strava_tokens'];
  v_expected text[];
  v_tables   text[];
  v_counts   text[];
  v_snap     jsonb;
  v_rel      text;
  v_priv     text;
  v_job      record;
BEGIN
  -- The snapshot.
  v_snap := public.backup_snapshot();
  IF v_snap->'excluded' IS DISTINCT FROM to_jsonb(v_excluded) THEN
    RAISE EXCEPTION '020: excluded is %, want %', v_snap->'excluded', to_jsonb(v_excluded);
  END IF;
  FOREACH v_rel IN ARRAY v_excluded LOOP
    IF (v_snap->'tables') ? v_rel OR (v_snap->'counts') ? v_rel THEN
      RAISE EXCEPTION '020: the snapshot exports excluded table %', v_rel;
    END IF;
  END LOOP;
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C"), '{}')
    INTO v_expected
    FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND NOT c.relispartition
     AND c.relname::text <> ALL (v_excluded);
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}') INTO v_tables
    FROM jsonb_object_keys(v_snap->'tables') k;
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}') INTO v_counts
    FROM jsonb_object_keys(v_snap->'counts') k;
  IF v_tables IS DISTINCT FROM v_expected OR v_counts IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '020: snapshot keys % / % do not match catalogue base tables minus exclusions %',
      v_tables, v_counts, v_expected;
  END IF;
  IF has_function_privilege('public', 'public.backup_snapshot()', 'execute')
     OR has_function_privilege('anon', 'public.backup_snapshot()', 'execute')
     OR has_function_privilege('authenticated', 'public.backup_snapshot()', 'execute')
     OR NOT has_function_privilege('service_role', 'public.backup_snapshot()', 'execute') THEN
    RAISE EXCEPTION '020: backup_snapshot() has wrong EXECUTE (want public/anon/authenticated false, service_role true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.backup_snapshot()'::regprocedure
                    AND p.prosecdef
                    AND p.provolatile = 's'
                    AND p.proowner = 'postgres'::regrole
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '020: backup_snapshot() is not STABLE SECURITY DEFINER owned by postgres with search_path=""';
  END IF;

  -- The table: no browser privilege, service_role kept, RLS on and unforced,
  -- no policy.
  FOREACH v_priv IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    IF has_table_privilege('anon', 'public.strava_activity_cache', v_priv)
       OR has_table_privilege('authenticated', 'public.strava_activity_cache', v_priv) THEN
      RAISE EXCEPTION '020: a browser role has % on strava_activity_cache', v_priv;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.strava_activity_cache', v_priv) THEN
      RAISE EXCEPTION '020: service_role lacks % on strava_activity_cache (strava-activity would fail)', v_priv;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = 'public.strava_activity_cache'::regclass
                    AND c.relrowsecurity
                    AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '020: strava_activity_cache must have RLS enabled and not forced';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = 'strava_activity_cache') THEN
    RAISE EXCEPTION '020: strava_activity_cache has a policy; it must have none';
  END IF;

  -- The sweep: internal, invoker rights, pinned search_path.
  IF has_function_privilege('public', 'public.strava_activity_cache_sweep()', 'execute')
     OR has_function_privilege('anon', 'public.strava_activity_cache_sweep()', 'execute')
     OR has_function_privilege('authenticated', 'public.strava_activity_cache_sweep()', 'execute')
     OR has_function_privilege('service_role', 'public.strava_activity_cache_sweep()', 'execute') THEN
    RAISE EXCEPTION '020: strava_activity_cache_sweep() is executable by an API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.strava_activity_cache_sweep()'::regprocedure
                    AND NOT p.prosecdef
                    AND p.proowner = 'postgres'::regrole
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '020: strava_activity_cache_sweep() is not SECURITY INVOKER owned by postgres with search_path=""';
  END IF;

  -- The cron job: exactly one, hourly at :23, active. `command` is not read.
  IF (SELECT count(*) FROM cron.job j WHERE j.jobname = 'strava-activity-cache-sweep') <> 1 THEN
    RAISE EXCEPTION '020: want exactly one cron job strava-activity-cache-sweep';
  END IF;
  SELECT j.jobname, j.schedule, j.active INTO v_job
    FROM cron.job j WHERE j.jobname = 'strava-activity-cache-sweep';
  IF v_job.schedule IS DISTINCT FROM '23 * * * *' OR v_job.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '020: cron job strava-activity-cache-sweep is % / active %', v_job.schedule, v_job.active;
  END IF;

  RAISE NOTICE '020: snapshot excludes %, exports % tables; strava_activity_cache private (RLS on, unforced, no policy, no browser grant); sweep internal; cron job active',
    v_excluded, cardinality(v_expected);
END $$;
