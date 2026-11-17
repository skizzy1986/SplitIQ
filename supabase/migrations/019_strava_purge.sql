-- 019_strava_purge.sql
-- Additive + reversible (019_strava_purge_rollback.sql). #630, slice 2 of the
-- Strava go-live (#628). Depends on 012 (the strava_* tables, the provenance
-- table and the two write RPCs) and 018. Apply in the same sitting as 011, 012
-- and 018, before any OAuth grant.
--
-- Every way Strava data leaves this database goes through the functions below:
--
--   purge_strava_user(user, 'disconnect' | 'revocation', dry_run)
--       Disconnect (strava-connect) and the revocation purge 21 days after
--       Strava refuses the grant (strava-import, phase B). Removes everything
--       the importer wrote for the user, restores what the athlete had typed,
--       and deletes the token, OAuth state and sync rows.
--   purge_strava_activities(user, activity_ids, linked_before, dry_run)
--       The deletion sync (strava-import reconcile.ts): the same removal for
--       individual activities the athlete deleted on Strava.
--   strava_link_inventory(user)
--       The reconcile pass's read of the user's links.
--
-- WHAT "REMOVE WHAT THE IMPORTER WROTE" MEANS, per strava_session_links row
-- (strava_unlink_sessions_internal):
--   * origin 'inserted', no athlete data on the row -> DELETE the session
--     (the link cascades; strength_workouts.session_id is ON DELETE SET NULL,
--     verified in pg_constraint 2026-11-17).
--   * origin 'inserted' but the athlete has since added their own data (sRPE,
--     a note, PRs, exercises, a coach flag, a benchmark key) -> KEEP the row,
--     put back avg_watts / avg_hr where the importer wrote them (prior is NULL
--     on an inserted row, so Strava's figures are stripped), clear
--     strava_activity_id, delete the link.
--   * origin 'adopted' -> the row was the athlete's all along: the same
--     restore + unlink.
--   date, label, type, duration, distance_m, status, source and every athlete
--   field are NEVER touched. A session with strava_activity_id but no link (an
--   "orphan", which only a write outside 012's RPCs could make) is unlinked
--   with its figures left alone: there is no record of what was written.
--
-- CONVENTIONS (012's): SECURITY DEFINER with `SET search_path = ''` and every
-- reference schema-qualified; `raise exception`, never ASSERT; a self-test that
-- always ends in the sentinel SQLSTATE 'SF019', so everything it wrote rolls
-- back (a PL/pgSQL block with an EXCEPTION clause is a subtransaction —
-- plpgsql-control-structures.html § Trapping Errors, via Context7
-- /websites/postgresql, as 012 quotes).
--
-- LOCK ORDER, in every function, so no two of them (or 012's RPCs) can
-- deadlock: strava_sync_state row -> strava_tokens row -> sessions rows
-- (ordered by id) -> strava_session_links rows. 012's write RPCs take the
-- sync row FOR SHARE first (its race guard), so a purge holding it FOR UPDATE
-- makes an in-flight import wait, then fail with P0003, instead of writing a
-- link after the purge commits.
--
-- IF THIS FILE STOPS HALF WAY. Whether apply_migration wraps a file in one
-- transaction is not established for this project, so the file is ordered so
-- that a failure at any point leaves nothing reachable: every function is
-- revoked from public, anon, authenticated AND service_role straight after it
-- is created, the self-test runs as postgres, and EXECUTE is granted to
-- service_role only after the self-test has passed. A failed apply leaves at
-- most functions no API role can call; CREATE OR REPLACE makes a re-run
-- idempotent, and the rollback drops them all.
--
-- APPLY: Scott approves; Supabase MCP apply_migration with name exactly
-- `019_strava_purge`, as postgres, after 012 and 018; then the manifest entry
-- flips to `applied` with the live version, and get_advisors is re-run.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '019 must run as postgres (the SECURITY DEFINER functions must be owned by a role that bypasses RLS): current_user=%', current_user;
  END IF;
  IF to_regclass('public.strava_session_links') IS NULL THEN
    RAISE EXCEPTION '019 needs 012_strava_integration applied first: public.strava_session_links does not exist';
  END IF;
  IF to_regclass('public.sessions_no_strava') IS NULL THEN
    RAISE EXCEPTION '019 needs 018_strava_backup_exclusion applied first: public.sessions_no_strava does not exist';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. strava_session_has_athlete_data — does a row carry anything the athlete
--    typed? Decides whether an importer-inserted row is deleted or kept.
-- ---------------------------------------------------------------------------
-- Empty means: NULL srpe; a blank note, coach flag or benchmark key; prs NULL
-- or 0 (the column defaults to 0 and the importer never writes it, so every
-- inserted row starts at 0); exercises NULL, JSON null, [] or {}.
CREATE OR REPLACE FUNCTION public.strava_session_has_athlete_data(
  p_srpe          integer,
  p_coach_note    text,
  p_prs           integer,
  p_exercises     jsonb,
  p_coach_flag    text,
  p_benchmark_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_srpe IS NOT NULL
      OR btrim(coalesce(p_coach_note, '')) <> ''
      OR coalesce(p_prs, 0) <> 0
      OR (p_exercises IS NOT NULL
          AND p_exercises NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
      OR btrim(coalesce(p_coach_flag, '')) <> ''
      OR btrim(coalesce(p_benchmark_key, '')) <> '';
$$;

REVOKE ALL ON FUNCTION public.strava_session_has_athlete_data(integer,text,integer,jsonb,text,text)
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.strava_session_has_athlete_data(integer,text,integer,jsonb,text,text) IS
  'True when a session carries anything the athlete entered: srpe, a non-blank '
  'coach_note / coach_flag / benchmark_key, prs other than 0, or exercises other '
  'than NULL / null / [] / {}. Used by the Strava purge to keep an '
  'importer-inserted row the athlete has since annotated. Internal: no API role '
  'may execute it.';

-- ---------------------------------------------------------------------------
-- 2. strava_unlink_sessions_internal — the per-row removal, shared by both
--    purges. SECURITY INVOKER and executable by NO API role, service_role
--    included: it trusts its caller to have taken the sync-row lock and chosen
--    the session ids, so only the two SECURITY DEFINER purges (running as
--    postgres, the owner) may call it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.strava_unlink_sessions_internal(
  p_user_id     uuid,
  p_session_ids bigint[],
  p_dry_run     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  r          record;
  v_action   text;
  v_deleted  int := 0;
  v_kept     int := 0;
  v_restored int := 0;
  v_actions  jsonb := '[]'::jsonb;
BEGIN
  IF p_session_ids IS NULL OR cardinality(p_session_ids) = 0 THEN
    RETURN jsonb_build_object('deleted', 0, 'kept', 0, 'restored', 0, 'actions', '[]'::jsonb);
  END IF;

  -- Lock order: the sessions rows (by id), then their links.
  PERFORM 1
     FROM public.sessions s
    WHERE s.user_id = p_user_id
      AND s.id = ANY (p_session_ids)
    ORDER BY s.id
      FOR UPDATE;

  FOR r IN
    SELECT l.session_id,
           l.strava_activity_id,
           l.origin,
           l.wrote_avg_watts,
           l.prior_avg_watts,
           l.wrote_avg_hr,
           l.prior_avg_hr,
           public.strava_session_has_athlete_data(
             s.srpe, s.coach_note, s.prs, s.exercises, s.coach_flag, s.benchmark_key
           ) AS has_data
      FROM public.strava_session_links l
      JOIN public.sessions s ON s.id = l.session_id
     WHERE l.user_id = p_user_id
       AND s.user_id = p_user_id
       AND l.session_id = ANY (p_session_ids)
     ORDER BY l.session_id
       FOR UPDATE OF l
  LOOP
    IF r.origin = 'inserted' AND NOT r.has_data THEN
      v_action := 'delete';
      v_deleted := v_deleted + 1;
    ELSIF r.origin = 'inserted' THEN
      v_action := 'keep_unlink';
      v_kept := v_kept + 1;
    ELSE
      v_action := 'restore_unlink';
      v_restored := v_restored + 1;
    END IF;

    IF NOT p_dry_run THEN
      IF v_action = 'delete' THEN
        -- The link goes with it (ON DELETE CASCADE).
        DELETE FROM public.sessions s
         WHERE s.id = r.session_id
           AND s.user_id = p_user_id;
      ELSE
        -- THE SET LIST IS THE WHOLE CONTRACT: the two figures the importer may
        -- have written, and the link column. Nothing else on the row moves.
        UPDATE public.sessions s SET
          avg_watts          = CASE WHEN r.wrote_avg_watts THEN r.prior_avg_watts ELSE s.avg_watts END,
          avg_hr             = CASE WHEN r.wrote_avg_hr    THEN r.prior_avg_hr    ELSE s.avg_hr    END,
          strava_activity_id = NULL
         WHERE s.id = r.session_id
           AND s.user_id = p_user_id;
        DELETE FROM public.strava_session_links l
         WHERE l.session_id = r.session_id;
      END IF;
    END IF;

    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'session_id', r.session_id,
      'activity_id', r.strava_activity_id,
      'action', v_action
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'kept', v_kept,
    'restored', v_restored,
    'actions', v_actions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.strava_unlink_sessions_internal(uuid,bigint[],boolean)
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.strava_unlink_sessions_internal(uuid,bigint[],boolean) IS
  'Internal to the Strava purges. For each strava_session_links row of the user '
  'among the given session ids: delete an importer-inserted session with no '
  'athlete data; otherwise restore avg_watts / avg_hr where the importer wrote '
  'them, clear strava_activity_id and delete the link. Never touches any other '
  'column. Dry run classifies only. Returns {deleted, kept, restored, actions}. '
  'Executable by no API role, service_role included: callers must hold the '
  'user''s strava_sync_state row lock.';

-- ---------------------------------------------------------------------------
-- 3. purge_strava_user — disconnect, and the revocation purge.
-- ---------------------------------------------------------------------------
-- 'disconnect' always purges (a second call finds nothing and returns zeros).
-- 'revocation' re-checks, under the locks, everything the cron's pre-filter
-- assumed: a sync row exists, it is disconnected, purge_due_at has passed, and
-- no reconnect is under way — a token row written after the disconnect means
-- the athlete is reconnecting (the OAuth callback writes the token before the
-- sync row), and their data stays.
CREATE OR REPLACE FUNCTION public.purge_strava_user(
  p_user_id uuid,
  p_reason  text,
  p_dry_run boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sync        public.strava_sync_state%ROWTYPE;
  v_has_sync    boolean;
  v_tok_updated timestamptz;
  v_has_tok     boolean;
  v_status      text;
  v_ids         bigint[];
  v_unlink      jsonb;
  v_orphans     int := 0;
  v_oauth       int := 0;
  -- A missing flag is a dry run: deleting is never the default.
  v_dry         boolean := coalesce(p_dry_run, true);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_strava_user: p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('disconnect', 'revocation') THEN
    RAISE EXCEPTION 'purge_strava_user: p_reason must be ''disconnect'' or ''revocation'''
      USING ERRCODE = '22023';
  END IF;

  -- Lock order: sync row, then token row. Either may be absent.
  SELECT st.* INTO v_sync
    FROM public.strava_sync_state st
   WHERE st.user_id = p_user_id
     FOR UPDATE;
  v_has_sync := FOUND;

  SELECT t.updated_at INTO v_tok_updated
    FROM public.strava_tokens t
   WHERE t.user_id = p_user_id
     FOR UPDATE;
  v_has_tok := FOUND;

  IF p_reason = 'revocation' THEN
    v_status := CASE
      WHEN NOT v_has_sync THEN 'no_state'
      WHEN v_sync.connected
        OR v_sync.purge_due_at IS NULL
        OR v_sync.purge_due_at > now() THEN 'not_due'
      WHEN v_has_tok AND v_tok_updated > v_sync.disconnected_at THEN 'reconnected'
      ELSE NULL
    END;
    IF v_status IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', v_status, 'reason', p_reason, 'dry_run', v_dry,
        'deleted', 0, 'kept', 0, 'restored', 0, 'orphans_unlinked', 0,
        'token_removed', false, 'oauth_states_removed', 0, 'sync_state_removed', false
      );
    END IF;
  END IF;

  SELECT coalesce(array_agg(l.session_id ORDER BY l.session_id), '{}'::bigint[])
    INTO v_ids
    FROM public.strava_session_links l
   WHERE l.user_id = p_user_id;

  v_unlink := public.strava_unlink_sessions_internal(p_user_id, v_ids, v_dry);

  IF v_dry THEN
    SELECT count(*) INTO v_orphans
      FROM public.sessions s
     WHERE s.user_id = p_user_id
       AND s.strava_activity_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = s.id);
    SELECT count(*) INTO v_oauth
      FROM public.strava_oauth_state o
     WHERE o.user_id = p_user_id;
  ELSE
    -- Orphans: a Strava id with no provenance. Unlinked; figures untouched.
    UPDATE public.sessions s SET strava_activity_id = NULL
     WHERE s.user_id = p_user_id
       AND s.strava_activity_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = s.id);
    GET DIAGNOSTICS v_orphans = ROW_COUNT;

    DELETE FROM public.strava_oauth_state o WHERE o.user_id = p_user_id;
    GET DIAGNOSTICS v_oauth = ROW_COUNT;
    DELETE FROM public.strava_tokens t WHERE t.user_id = p_user_id;
    DELETE FROM public.strava_sync_state st WHERE st.user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_dry THEN 'would_purge' ELSE 'purged' END,
    'reason', p_reason,
    'dry_run', v_dry,
    'deleted', (v_unlink->>'deleted')::int,
    'kept', (v_unlink->>'kept')::int,
    'restored', (v_unlink->>'restored')::int,
    'orphans_unlinked', v_orphans,
    'token_removed', v_has_tok,
    'oauth_states_removed', v_oauth,
    'sync_state_removed', v_has_sync
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_strava_user(uuid,text,boolean)
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.purge_strava_user(uuid,text,boolean) IS
  'Remove a user''s Strava-derived data (#630): delete importer-inserted '
  'sessions with no athlete data, restore and unlink the rest, unlink orphans, '
  'and delete the strava_oauth_state, strava_tokens and strava_sync_state rows. '
  'p_reason ''disconnect'' always purges; ''revocation'' only when disconnected, '
  'past purge_due_at and with no token newer than the disconnect (else '
  'not_due / no_state / reconnected). Dry run counts only. Returns {status, '
  'reason, dry_run, deleted, kept, restored, orphans_unlinked, token_removed, '
  'oauth_states_removed, sync_state_removed}. Idempotent. service_role only.';

-- ---------------------------------------------------------------------------
-- 4. strava_link_inventory — the reconcile pass's view of the user's links.
-- ---------------------------------------------------------------------------
-- Dates come from sessions.date_iso only (the generated DATE), never the text
-- `date`, so ordering and the reconcile window are right across a year.
CREATE OR REPLACE FUNCTION public.strava_link_inventory(p_user_id uuid)
RETURNS TABLE (session_id bigint, strava_activity_id bigint, date_iso date, link_created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.session_id, l.strava_activity_id, s.date_iso, l.created_at
    FROM public.strava_session_links l
    JOIN public.sessions s ON s.id = l.session_id
   WHERE l.user_id = p_user_id
     AND s.user_id = p_user_id
   ORDER BY s.date_iso NULLS LAST, l.session_id;
$$;

REVOKE ALL ON FUNCTION public.strava_link_inventory(uuid)
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.strava_link_inventory(uuid) IS
  'The user''s Strava links as (session_id, strava_activity_id, date_iso, '
  'link_created_at), ordered by date_iso. Read by the deletion sync '
  '(strava-import reconcile.ts, #630). service_role only.';

-- ---------------------------------------------------------------------------
-- 5. purge_strava_activities — the deletion sync's removal.
-- ---------------------------------------------------------------------------
-- p_linked_before is the moment the reconcile listing started: a link made at
-- or after it may be for an activity the listing had already paged past, so
-- it is never removed by this call (the server half of the cut-off
-- reconcile.ts applies when choosing candidates). Tokens, OAuth state and the
-- sync row are not touched.
CREATE OR REPLACE FUNCTION public.purge_strava_activities(
  p_user_id       uuid,
  p_activity_ids  bigint[],
  p_linked_before timestamptz,
  p_dry_run       boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dry     boolean := coalesce(p_dry_run, true);
  v_wanted  bigint[];
  v_ids     bigint[];
  v_unlink  jsonb;
  v_actions jsonb;
BEGIN
  IF p_user_id IS NULL OR p_linked_before IS NULL THEN
    RAISE EXCEPTION 'purge_strava_activities: p_user_id and p_linked_before are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT u.x), '{}'::bigint[])
    INTO v_wanted
    FROM unnest(coalesce(p_activity_ids, '{}'::bigint[])) AS u(x)
   WHERE u.x IS NOT NULL;

  IF cardinality(v_wanted) = 0 THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_dry THEN 'would_purge' ELSE 'purged' END,
      'deleted', 0, 'kept', 0, 'restored', 0, 'not_found', 0, 'actions', '[]'::jsonb
    );
  END IF;

  -- Lock order: the sync row first (it may be absent; the lock is what makes
  -- a concurrent import's write RPC wait).
  PERFORM 1
     FROM public.strava_sync_state st
    WHERE st.user_id = p_user_id
      FOR UPDATE;

  SELECT coalesce(array_agg(l.session_id ORDER BY l.session_id), '{}'::bigint[])
    INTO v_ids
    FROM public.strava_session_links l
   WHERE l.user_id = p_user_id
     AND l.strava_activity_id = ANY (v_wanted)
     AND l.created_at < p_linked_before;

  v_unlink := public.strava_unlink_sessions_internal(p_user_id, v_ids, v_dry);

  SELECT coalesce(jsonb_agg(jsonb_build_object('activity_id', e.a->'activity_id', 'action', e.a->'action')),
                  '[]'::jsonb)
    INTO v_actions
    FROM jsonb_array_elements(v_unlink->'actions') AS e(a);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_dry THEN 'would_purge' ELSE 'purged' END,
    'deleted', (v_unlink->>'deleted')::int,
    'kept', (v_unlink->>'kept')::int,
    'restored', (v_unlink->>'restored')::int,
    'not_found', cardinality(v_wanted) - jsonb_array_length(v_unlink->'actions'),
    'actions', v_actions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_strava_activities(uuid,bigint[],timestamptz,boolean)
  FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.purge_strava_activities(uuid,bigint[],timestamptz,boolean) IS
  'Remove what the Strava importer wrote for the given activities of one user '
  '(the deletion sync, #630), limited to links created before p_linked_before. '
  'Same per-row rule as purge_strava_user; tokens, OAuth state and sync state '
  'untouched. Dry run classifies only. Returns {status, deleted, kept, '
  'restored, not_found, actions:[{activity_id, action}]}. service_role only.';

-- ---------------------------------------------------------------------------
-- Self-test, BEFORE any API role can execute anything above. Synthetic data
-- only: random user ids (sessions.user_id and strava_sync_state.user_id have
-- no foreign key), labels carrying a random tag (sessions has a global
-- UNIQUE (date, label)), dates no real row is near. No real row is read or
-- printed. No strava_tokens row: its user_id references auth.users, and this
-- test does not fabricate an auth user (Gate 2, Q-B), so the token branches
-- (token_removed, 'reconnected') are proven by the Deno fakes and the owner's
-- read-back instead. The sessions identity sequence advances (sequences do not
-- roll back); ids carry no meaning, so that is harmless.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();  -- the athlete under test
  v_user2  uuid := gen_random_uuid();  -- another athlete (row H)
  v_user3  uuid := gen_random_uuid();  -- purge_strava_activities' athlete
  v_tag    text := replace(gen_random_uuid()::text, '-', '');
  v_a      bigint;  -- inserted, no athlete data
  v_b      bigint;  -- inserted, prs 0 / exercises [] / blank note: still empty
  v_c      bigint;  -- inserted, srpe 6: kept
  v_e      bigint;  -- adopted, prior watts 140 written, prior HR NULL written
  v_f      bigint;  -- adopted, nothing written
  v_g      bigint;  -- orphan: strava_activity_id set directly, no link
  v_h      bigint;  -- another user's linked row
  v_hand   bigint;  -- a hand row with no Strava link
  v_p      bigint;  -- user3: inserted, no data
  v_q      bigint;  -- user3: inserted, with a note
  v_r      bigint;  -- user3: inserted, linked after p_linked_before
  v_res    jsonb;
  v_s      record;
  v_n      bigint;
  v_dates  date[];
  v_sorted date[];
  v_raised boolean;
BEGIN
  BEGIN
    -- ---- setup ------------------------------------------------------------
    -- Connected sync rows first: 012's race guard refuses to link without one.
    INSERT INTO public.strava_sync_state (user_id, connected, backfill_from)
    VALUES (v_user, true, DATE '2000-01-01'),
           (v_user2, true, DATE '2000-01-01'),
           (v_user3, true, DATE '2000-01-01');
    INSERT INTO public.strava_oauth_state (state_hash, user_id)
    VALUES ('sf019-' || v_tag || '-1', v_user),
           ('sf019-' || v_tag || '-2', v_user);

    SELECT r.session_id INTO v_a FROM public.upsert_strava_session(v_user, 901900000001, '1/1/00', 'erg',
      'strava-019-selftest-A-' || v_tag, '25:00', 6000, 150, 130, 'Concept2 PM5') r;
    SELECT r.session_id INTO v_b FROM public.upsert_strava_session(v_user, 901900000002, '1/2/00', 'erg',
      'strava-019-selftest-B-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    UPDATE public.sessions s SET prs = 0, exercises = '[]'::jsonb, coach_note = '   ' WHERE s.id = v_b;
    SELECT r.session_id INTO v_c FROM public.upsert_strava_session(v_user, 901900000003, '12/31/99', 'erg',
      'strava-019-selftest-C-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    UPDATE public.sessions s SET srpe = 6 WHERE s.id = v_c;

    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m, avg_watts, avg_hr,
                                 status, source, coach_note)
    VALUES (v_user, '1/2/00', 'Z2 Aerobic', 'strava-019-selftest-E-' || v_tag, '30min', 7000, 140, NULL,
            'completed', 'portal', 'sf019 note')
    RETURNING id INTO v_e;
    PERFORM public.adopt_strava_session(v_user, v_e, 901900000005, 160, true, 135, NULL);

    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m, avg_watts, avg_hr,
                                 status, source)
    VALUES (v_user, '1/1/00', 'Cycling', 'strava-019-selftest-F-' || v_tag, '60min', 22900, 180, 120,
            'completed', 'portal')
    RETURNING id INTO v_f;
    PERFORM public.adopt_strava_session(v_user, v_f, 901900000006, NULL, false, NULL, NULL);

    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m, avg_watts,
                                 status, source, strava_activity_id)
    VALUES (v_user, '1/1/00', 'erg', 'strava-019-selftest-G-' || v_tag, '20min', 5000, 111,
            'completed', 'strava', 901900000007)
    RETURNING id INTO v_g;

    SELECT r.session_id INTO v_h FROM public.upsert_strava_session(v_user2, 901900000008, '1/1/00', 'erg',
      'strava-019-selftest-H-' || v_tag, '25:00', 6000, 150, 130, NULL) r;

    INSERT INTO public.sessions (user_id, date, type, label, duration, status, source, srpe)
    VALUES (v_user, '1/1/00', 'Strength', 'strava-019-selftest-hand-' || v_tag, '45min', 'completed', 'portal', 7)
    RETURNING id INTO v_hand;

    SELECT r.session_id INTO v_p FROM public.upsert_strava_session(v_user3, 901900000011, '1/1/00', 'erg',
      'strava-019-selftest-P-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    SELECT r.session_id INTO v_q FROM public.upsert_strava_session(v_user3, 901900000012, '1/1/00', 'erg',
      'strava-019-selftest-Q-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    UPDATE public.sessions s SET coach_note = 'kept note' WHERE s.id = v_q;
    SELECT r.session_id INTO v_r FROM public.upsert_strava_session(v_user3, 901900000013, '1/1/00', 'erg',
      'strava-019-selftest-R-' || v_tag, '25:00', 6000, 150, 130, NULL) r;
    -- now() is the transaction start, so P's and Q's links carry created_at =
    -- now() exactly (012's column default). Step (4) therefore cuts off at
    -- now() + 30 minutes (P and Q before it) and R is pushed to now() + 2 hours
    -- (after it). A cut-off of now() itself would exclude P and Q too.
    UPDATE public.strava_session_links l SET created_at = now() + interval '2 hours' WHERE l.session_id = v_r;

    IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL OR v_h IS NULL OR v_p IS NULL OR v_q IS NULL OR v_r IS NULL
       OR (SELECT count(*) FROM public.strava_session_links l WHERE l.user_id = v_user) <> 5 THEN
      RAISE EXCEPTION '019 self-test: setup did not produce the expected links';
    END IF;

    -- ---- (1) the athlete-data truth table -----------------------------------
    IF public.strava_session_has_athlete_data(NULL, NULL, NULL, NULL, NULL, NULL)
       OR public.strava_session_has_athlete_data(NULL, '  ', 0, '[]'::jsonb, ' ', '')
       OR public.strava_session_has_athlete_data(NULL, NULL, NULL, 'null'::jsonb, NULL, NULL)
       OR public.strava_session_has_athlete_data(NULL, NULL, NULL, '{}'::jsonb, NULL, NULL)
       OR NOT public.strava_session_has_athlete_data(6, NULL, NULL, NULL, NULL, NULL)
       OR NOT public.strava_session_has_athlete_data(NULL, 'x', NULL, NULL, NULL, NULL)
       OR NOT public.strava_session_has_athlete_data(NULL, NULL, 1, NULL, NULL, NULL)
       OR NOT public.strava_session_has_athlete_data(NULL, NULL, NULL, '[{"name":"row"}]'::jsonb, NULL, NULL)
       OR NOT public.strava_session_has_athlete_data(NULL, NULL, NULL, NULL, 'flag', NULL)
       OR NOT public.strava_session_has_athlete_data(NULL, NULL, NULL, NULL, NULL, 'bench') THEN
      RAISE EXCEPTION '019 self-test: strava_session_has_athlete_data truth table is wrong';
    END IF;

    -- ---- (2) disconnect dry run: right counts, nothing changed --------------
    v_res := public.purge_strava_user(v_user, 'disconnect', true);
    IF v_res->>'status' IS DISTINCT FROM 'would_purge'
       OR (v_res->>'deleted')::int <> 2 OR (v_res->>'kept')::int <> 1
       OR (v_res->>'restored')::int <> 2 OR (v_res->>'orphans_unlinked')::int <> 1
       OR (v_res->>'oauth_states_removed')::int <> 2
       OR (v_res->>'sync_state_removed')::boolean IS DISTINCT FROM true
       OR (v_res->>'token_removed')::boolean IS DISTINCT FROM false THEN
      RAISE EXCEPTION '019 self-test: disconnect dry run returned %', v_res;
    END IF;
    IF (SELECT count(*) FROM public.strava_session_links l WHERE l.user_id = v_user) <> 5
       OR NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_a)
       OR NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_b)
       OR (SELECT s.strava_activity_id FROM public.sessions s WHERE s.id = v_g) IS NULL
       OR (SELECT s.avg_watts FROM public.sessions s WHERE s.id = v_e) IS DISTINCT FROM 160
       OR NOT EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id = v_user)
       OR (SELECT count(*) FROM public.strava_oauth_state o WHERE o.user_id = v_user) <> 2 THEN
      RAISE EXCEPTION '019 self-test: a disconnect DRY RUN changed something';
    END IF;

    -- ---- (3) revocation: not due until disconnected AND past the deadline ---
    v_res := public.purge_strava_user(v_user, 'revocation', true);
    IF v_res->>'status' IS DISTINCT FROM 'not_due' THEN
      RAISE EXCEPTION '019 self-test: revocation of a connected user returned %', v_res->>'status';
    END IF;
    UPDATE public.strava_sync_state st
       SET connected = false, disconnected_at = now(), purge_due_at = now() + interval '21 days'
     WHERE st.user_id = v_user;
    v_res := public.purge_strava_user(v_user, 'revocation', true);
    IF v_res->>'status' IS DISTINCT FROM 'not_due' THEN
      RAISE EXCEPTION '019 self-test: revocation before purge_due_at returned %', v_res->>'status';
    END IF;
    UPDATE public.strava_sync_state st SET purge_due_at = now() - interval '1 second' WHERE st.user_id = v_user;
    v_res := public.purge_strava_user(v_user, 'revocation', true);
    IF v_res->>'status' IS DISTINCT FROM 'would_purge'
       OR (v_res->>'deleted')::int <> 2 OR (v_res->>'kept')::int <> 1 OR (v_res->>'restored')::int <> 2 THEN
      RAISE EXCEPTION '019 self-test: a due revocation dry run returned %', v_res;
    END IF;
    IF (SELECT count(*) FROM public.strava_session_links l WHERE l.user_id = v_user) <> 5 THEN
      RAISE EXCEPTION '019 self-test: a revocation DRY RUN changed something';
    END IF;
    v_res := public.purge_strava_user(gen_random_uuid(), 'revocation', true);
    IF v_res->>'status' IS DISTINCT FROM 'no_state' THEN
      RAISE EXCEPTION '019 self-test: revocation with no sync row returned %', v_res->>'status';
    END IF;

    -- ---- (4) purge_strava_activities (user3) --------------------------------
    -- Empty and NULL arrays are no-ops.
    v_res := public.purge_strava_activities(v_user3, '{}'::bigint[], now(), false);
    IF (v_res->>'deleted')::int <> 0 OR (v_res->>'not_found')::int <> 0 THEN
      RAISE EXCEPTION '019 self-test: an empty activity list did something: %', v_res;
    END IF;
    v_res := public.purge_strava_activities(v_user3, NULL, now(), false);
    IF (v_res->>'deleted')::int <> 0 THEN
      RAISE EXCEPTION '019 self-test: a NULL activity list did something: %', v_res;
    END IF;
    -- Dry run: classifies, changes nothing. The cut-off is now() + 30 minutes:
    -- P's and Q's links (created_at = now(), the transaction start) fall before
    -- it, R's (now() + 2 hours) after it. R is therefore not_found, as is H's
    -- activity (another user's); 999... does not exist.
    v_res := public.purge_strava_activities(v_user3,
      ARRAY[901900000011, 901900000012, 901900000013, 901900000008, 901900999999]::bigint[],
      now() + interval '30 minutes', true);
    IF v_res->>'status' IS DISTINCT FROM 'would_purge'
       OR (v_res->>'deleted')::int <> 1 OR (v_res->>'kept')::int <> 1 OR (v_res->>'restored')::int <> 0
       OR (v_res->>'not_found')::int <> 3
       OR NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_p) THEN
      RAISE EXCEPTION '019 self-test: purge_strava_activities dry run returned % or changed a row', v_res;
    END IF;
    v_res := public.purge_strava_activities(v_user3,
      ARRAY[901900000011, 901900000012, 901900000013, 901900000008, 901900999999]::bigint[],
      now() + interval '30 minutes', false);
    IF v_res->>'status' IS DISTINCT FROM 'purged'
       OR (v_res->>'deleted')::int <> 1 OR (v_res->>'kept')::int <> 1 OR (v_res->>'not_found')::int <> 3
       OR NOT (v_res->'actions' @> '[{"activity_id": 901900000011, "action": "delete"}]'::jsonb)
       OR NOT (v_res->'actions' @> '[{"activity_id": 901900000012, "action": "keep_unlink"}]'::jsonb)
       OR jsonb_array_length(v_res->'actions') <> 2 THEN
      RAISE EXCEPTION '019 self-test: purge_strava_activities returned %', v_res;
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_q;
    IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = v_p)
       OR v_s.id IS NULL OR v_s.strava_activity_id IS NOT NULL
       OR v_s.avg_watts IS NOT NULL OR v_s.avg_hr IS NOT NULL
       OR v_s.coach_note IS DISTINCT FROM 'kept note' OR v_s.duration IS DISTINCT FROM '25:00'
       OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_q)
       OR NOT EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_r)
       OR (SELECT s.strava_activity_id FROM public.sessions s WHERE s.id = v_r) IS DISTINCT FROM 901900000013
       OR NOT EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_h)
       OR NOT EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id = v_user3) THEN
      RAISE EXCEPTION '019 self-test: purge_strava_activities left the wrong rows';
    END IF;

    -- ---- (5) inventory: own rows only, date_iso, ordered --------------------
    SELECT count(*), array_agg(i.date_iso ORDER BY i.n), array_agg(i.date_iso ORDER BY i.date_iso)
      INTO v_n, v_dates, v_sorted
      FROM public.strava_link_inventory(v_user)
           WITH ORDINALITY AS i(session_id, strava_activity_id, date_iso, link_created_at, n);
    IF v_n <> 5
       OR v_dates IS DISTINCT FROM v_sorted
       OR v_dates[1] IS DISTINCT FROM DATE '2000-01-01'
       OR v_dates[5] IS DISTINCT FROM DATE '2099-12-31'
       OR NOT (DATE '2000-01-02' = ANY (v_dates))
       OR EXISTS (SELECT 1 FROM public.strava_link_inventory(v_user) i WHERE i.session_id IN (v_h, v_g, v_hand)) THEN
      RAISE EXCEPTION '019 self-test: strava_link_inventory returned % rows, dates %', v_n, v_dates;
    END IF;

    -- ---- (6) the real disconnect ---------------------------------------------
    v_res := public.purge_strava_user(v_user, 'disconnect', false);
    IF v_res->>'status' IS DISTINCT FROM 'purged'
       OR (v_res->>'deleted')::int <> 2 OR (v_res->>'kept')::int <> 1
       OR (v_res->>'restored')::int <> 2 OR (v_res->>'orphans_unlinked')::int <> 1
       OR (v_res->>'oauth_states_removed')::int <> 2
       OR (v_res->>'sync_state_removed')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION '019 self-test: disconnect returned %', v_res;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.id IN (v_a, v_b)) THEN
      RAISE EXCEPTION '019 self-test: an importer-inserted row with no athlete data survived';
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_c;
    IF v_s.id IS NULL OR v_s.srpe IS DISTINCT FROM 6 OR v_s.date IS DISTINCT FROM '12/31/99'
       OR v_s.label IS DISTINCT FROM 'strava-019-selftest-C-' || v_tag
       OR v_s.duration IS DISTINCT FROM '25:00' OR v_s.distance_m IS DISTINCT FROM 6000
       OR v_s.source IS DISTINCT FROM 'strava' OR v_s.status IS DISTINCT FROM 'completed'
       OR v_s.avg_watts IS NOT NULL OR v_s.avg_hr IS NOT NULL OR v_s.strava_activity_id IS NOT NULL THEN
      RAISE EXCEPTION '019 self-test: kept row C is wrong (watts %, hr %)', v_s.avg_watts, v_s.avg_hr;
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_e;
    IF v_s.avg_watts IS DISTINCT FROM 140 OR v_s.avg_hr IS NOT NULL
       OR v_s.coach_note IS DISTINCT FROM 'sf019 note' OR v_s.duration IS DISTINCT FROM '30min'
       OR v_s.distance_m IS DISTINCT FROM 7000 OR v_s.strava_activity_id IS NOT NULL THEN
      RAISE EXCEPTION '019 self-test: adopted row E was not restored (watts %, hr %)', v_s.avg_watts, v_s.avg_hr;
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_f;
    IF v_s.avg_watts IS DISTINCT FROM 180 OR v_s.avg_hr IS DISTINCT FROM 120
       OR v_s.duration IS DISTINCT FROM '60min' OR v_s.strava_activity_id IS NOT NULL THEN
      RAISE EXCEPTION '019 self-test: adopted row F changed beyond its unlink';
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_g;
    IF v_s.strava_activity_id IS NOT NULL OR v_s.avg_watts IS DISTINCT FROM 111 THEN
      RAISE EXCEPTION '019 self-test: orphan G was not unlinked, or its figures moved';
    END IF;
    IF EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.strava_oauth_state o WHERE o.user_id = v_user)
       OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = v_user AND s.strava_activity_id IS NOT NULL) THEN
      RAISE EXCEPTION '019 self-test: Strava state for the purged user survived';
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_h;
    IF v_s.strava_activity_id IS DISTINCT FROM 901900000008 OR v_s.avg_watts IS DISTINCT FROM 150
       OR NOT EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_h)
       OR NOT EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id = v_user2) THEN
      RAISE EXCEPTION '019 self-test: another user''s row H was touched';
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand;
    IF v_s.id IS NULL OR v_s.srpe IS DISTINCT FROM 7 OR v_s.duration IS DISTINCT FROM '45min' THEN
      RAISE EXCEPTION '019 self-test: the hand row with no Strava link was touched';
    END IF;

    -- ---- (7) idempotent ------------------------------------------------------
    v_res := public.purge_strava_user(v_user, 'disconnect', false);
    IF v_res->>'status' IS DISTINCT FROM 'purged'
       OR (v_res->>'deleted')::int <> 0 OR (v_res->>'kept')::int <> 0 OR (v_res->>'restored')::int <> 0
       OR (v_res->>'orphans_unlinked')::int <> 0 OR (v_res->>'oauth_states_removed')::int <> 0
       OR (v_res->>'sync_state_removed')::boolean IS DISTINCT FROM false THEN
      RAISE EXCEPTION '019 self-test: a second disconnect was not a zero purge: %', v_res;
    END IF;
    v_res := public.purge_strava_user(v_user, 'revocation', false);
    IF v_res->>'status' IS DISTINCT FROM 'no_state' THEN
      RAISE EXCEPTION '019 self-test: revocation after a disconnect returned %', v_res->>'status';
    END IF;

    -- ---- (8) bad reason -> 22023 --------------------------------------------
    v_raised := false;
    BEGIN
      PERFORM public.purge_strava_user(v_user2, 'everything', false);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '019 self-test: an unknown p_reason did not raise 22023';
    END IF;

    RAISE EXCEPTION 'rollback' USING ERRCODE = 'SF019';
  EXCEPTION WHEN SQLSTATE 'SF019' THEN
    NULL;  -- the sentinel: everything above is rolled back
  END;

  -- ---- (9) nothing synthetic survives ---------------------------------------
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id IN (v_user, v_user2, v_user3))
     OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.user_id IN (v_user, v_user2, v_user3))
     OR EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id IN (v_user, v_user2, v_user3))
     OR EXISTS (SELECT 1 FROM public.strava_oauth_state o WHERE o.user_id IN (v_user, v_user2, v_user3)) THEN
    RAISE EXCEPTION '019 self-test: synthetic rows survived the rollback';
  END IF;

  RAISE NOTICE '019: purge self-test passed (truth table, disconnect dry run and purge, revocation gates, deletion-sync purge with cut-off, inventory, idempotence, bad reason); all synthetic rows rolled back';
END $$;

-- ---------------------------------------------------------------------------
-- Grants — only now that the self-test has passed. See the header: revoking
-- from PUBLIC is the half that matters, and it was done at each CREATE.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.purge_strava_user(uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.strava_link_inventory(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_strava_activities(uuid,bigint[],timestamptz,boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Assertions. A SECURITY DEFINER purge reachable by anon or authenticated
-- would let any caller delete any user's sessions by naming a uuid.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.purge_strava_user(uuid,text,boolean)',
    'public.strava_link_inventory(uuid)',
    'public.purge_strava_activities(uuid,bigint[],timestamptz,boolean)'
  ] LOOP
    IF has_function_privilege('public', v_fn, 'execute')
       OR has_function_privilege('anon', v_fn, 'execute')
       OR has_function_privilege('authenticated', v_fn, 'execute')
       OR NOT has_function_privilege('service_role', v_fn, 'execute') THEN
      RAISE EXCEPTION '019: % has wrong EXECUTE (want public/anon/authenticated false, service_role true)', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn::regprocedure
                      AND p.prosecdef
                      AND p.proowner = 'postgres'::regrole
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '019: % is not SECURITY DEFINER owned by postgres with search_path=""', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.strava_session_has_athlete_data(integer,text,integer,jsonb,text,text)',
    'public.strava_unlink_sessions_internal(uuid,bigint[],boolean)'
  ] LOOP
    IF has_function_privilege('public', v_fn, 'execute')
       OR has_function_privilege('anon', v_fn, 'execute')
       OR has_function_privilege('authenticated', v_fn, 'execute')
       OR has_function_privilege('service_role', v_fn, 'execute') THEN
      RAISE EXCEPTION '019: % is executable by an API role; it must be internal', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn::regprocedure
                      AND NOT p.prosecdef
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '019: % is not SECURITY INVOKER with search_path=""', v_fn;
    END IF;
  END LOOP;

  -- Exactly one function of each name: an old overload would be a second,
  -- unreviewed way to delete sessions.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('strava_session_has_athlete_data', 'strava_unlink_sessions_internal',
                           'purge_strava_user', 'strava_link_inventory', 'purge_strava_activities')) <> 5 THEN
    RAISE EXCEPTION '019: an extra overload of a Strava purge function exists';
  END IF;

  RAISE NOTICE '019: grants and definer settings verified for all five functions';
END $$;
