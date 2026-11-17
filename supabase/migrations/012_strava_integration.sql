-- 012_strava_integration.sql
-- Additive + reversible (012_strava_integration_rollback.sql). Everything the
-- Strava import (#54, made deployable by #629) needs that is not already on
-- public.sessions: the token store, the OAuth single-use state store, the
-- per-user sync cursor, the provenance table recording what the importer wrote
-- onto each session, and the two SECURITY DEFINER RPCs that are the ONLY
-- sanctioned way to write a Strava link onto a session.
--
-- Depends on 011 (public.sessions.strava_activity_id + the partial unique
-- index). Apply 011 first; roll 012 back first. Apply 018 straight after this
-- one, in the same sitting: until 018 runs, backup_snapshot() (017) exports
-- every public base table, and that includes the four strava_* tables below.
--
-- Security properties, each called out where it appears:
--   * strava_tokens, strava_oauth_state and strava_session_links have RLS
--     ENABLED, carry NO policies, and grant nothing to anon or authenticated,
--     so no browser role can reach a row by any path. That is the whole of
--     their privacy. RLS is NOT forced, and forcing it would protect nothing:
--     on this project postgres (the owner) and service_role both have
--     rolbypassrls = true, and FORCE ROW LEVEL SECURITY does not bind a
--     BYPASSRLS role. backup_snapshot() is SECURITY DEFINER owned by postgres,
--     so FORCE never kept these tables out of the nightly snapshot either —
--     018 does that, explicitly, with an exclusion list. 017's self-test also
--     refuses FORCE on any public table, because a forced table would export
--     only the rows its policies let postgres see. A policy added later on any
--     of the three is a regression, not a feature.
--   * strava_sync_state is the one table the browser may read, and only read.
--   * both RPCs are revoked from PUBLIC/anon/authenticated and granted only to
--     service_role. `revoke ... from public` is the load-bearing half: PUBLIC
--     is the pseudo-role the default EXECUTE grant on a new function flows
--     through, so revoking from anon and authenticated alone leaves the
--     function callable by both.

-- ---------------------------------------------------------------------------
-- strava_tokens — the OAuth credential store. One row per connected user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strava_tokens (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id    bigint NOT NULL,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  scope         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Enabled, no policies, no browser grants. Not FORCED: see the header.
ALTER TABLE public.strava_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_tokens FROM public, anon, authenticated;

COMMENT ON TABLE public.strava_tokens IS
  'Strava OAuth credentials. DELIBERATELY POLICY-LESS: RLS is enabled, there '
  'is no policy of any kind and nothing is granted to anon or authenticated, '
  'so no browser role can reach a row by any path. postgres and service_role '
  '(the edge functions) bypass RLS and can read it; that is why the nightly '
  'backup_snapshot() excludes it by name (migration 018) rather than relying '
  'on RLS. ADDING A POLICY HERE IS A SECURITY REGRESSION — it would hand a '
  'bearer token that grants full read access to the athlete''s entire Strava '
  'history to anything holding a session JWT, including any XSS on the '
  'dashboard. The browser never needs these values: it reads connection state '
  'from public.strava_sync_state instead. refresh_token is rotated by Strava '
  'on every refresh; see supabase/functions/strava-import/tokens.ts for the '
  'compare-and-swap that keeps a rotation from being lost.';

-- ---------------------------------------------------------------------------
-- strava_oauth_state — single-use CSRF state for the authorize round trip.
-- ---------------------------------------------------------------------------
-- Only the SHA-256 of the state is stored. The row is the sole thing providing
-- single-use semantics and the sole binding from a state value to a user, so
-- the state itself can be (and is) a plain opaque 32-byte random token with no
-- HMAC and nothing embedded in it.
CREATE TABLE IF NOT EXISTS public.strava_oauth_state (
  state_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);

ALTER TABLE public.strava_oauth_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_oauth_state FROM public, anon, authenticated;

CREATE INDEX IF NOT EXISTS strava_oauth_state_created_at_idx
  ON public.strava_oauth_state (created_at);

COMMENT ON TABLE public.strava_oauth_state IS
  'Single-use CSRF state for the Strava authorize round trip, keyed by '
  'sha256(state) so a leaked row does not yield a usable state value. '
  'DELIBERATELY POLICY-LESS (RLS enabled, no policies, no grants to anon or '
  'authenticated) — a browser role that could read this table could enumerate '
  'live states and complete another user''s connect. postgres and service_role '
  'bypass RLS; the nightly backup excludes the table by name (migration 018). '
  'Redemption is one atomic UPDATE ... WHERE redeemed_at IS NULL RETURNING '
  'user_id; never check-then-set. Rows older than an hour are pruned at the '
  'top of every connect.';

-- ---------------------------------------------------------------------------
-- strava_sync_state — per-user cursor, counters and last-run outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strava_sync_state (
  user_id                uuid PRIMARY KEY,
  connected              boolean NOT NULL DEFAULT false,
  athlete_id             bigint,
  scope                  text,
  connected_at           timestamptz,
  disconnected_at        timestamptz,
  backfill_from          date NOT NULL,
  backfill_complete      boolean NOT NULL DEFAULT false,
  backfill_cursor_before bigint,
  incremental_after      bigint,
  last_run_at            timestamptz,
  last_run_mode          text,
  last_run_status        text,
  last_error_code        text,
  imported_total         int NOT NULL DEFAULT 0,
  adopted_total          int NOT NULL DEFAULT 0,
  skipped_total          int NOT NULL DEFAULT 0,
  failed_total           int NOT NULL DEFAULT 0,
  ambiguous_activity_ids bigint[] NOT NULL DEFAULT '{}',
  rate_limit_resets_at   timestamptz,
  purge_due_at           timestamptz,
  reconcile_due_at       timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strava_sync_state_last_run_status_known
    CHECK (last_run_status IS NULL OR last_run_status IN
      ('ok', 'partial', 'noop', 'rate_limited', 'auth_failed', 'error')),
  -- There is NO free-text error column on this table, and that is the point.
  -- String(e) from a failed token exchange routinely carries the whole response
  -- body, which for Strava's /oauth/token includes the access and refresh
  -- tokens. Storing it here would put credentials in a table the browser can
  -- read. Free-text detail goes to Sentry; the row gets a bounded code.
  CONSTRAINT strava_sync_state_last_error_code_known
    CHECK (last_error_code IS NULL OR last_error_code IN
      ('token_exchange_failed', 'refresh_failed', 'auth_failed', 'rate_limited',
       'upstream_5xx', 'insufficient_scope', 'db_write_failed', 'unknown'))
);

ALTER TABLE public.strava_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_sync_state FROM public, anon, authenticated;
GRANT SELECT ON public.strava_sync_state TO authenticated;

-- SELECT only, and only your own row. There is deliberately no INSERT/UPDATE/
-- DELETE policy: every mutation is made by the edge functions as service_role.
-- A browser that could write here could reset backfill_cursor_before and make
-- the importer re-walk (and, with 011's unique index, harmlessly re-update)
-- ten weeks of history on every run, or set connected=false and silently stop
-- the sync.
DROP POLICY IF EXISTS strava_sync_state_owner_select ON public.strava_sync_state;
CREATE POLICY strava_sync_state_owner_select ON public.strava_sync_state
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.strava_sync_state IS
  'Per-user Strava sync cursor, counters and last-run outcome. Readable by its '
  'owner (SELECT policy) so the UI can show connection state and the last run; '
  'writable only by service_role. last_error_code is a bounded enum on purpose '
  '— see the CHECK comment. ambiguous_activity_ids holds activities the '
  'adoption pass refused to guess on; they need a human decision, and a run '
  'that appends to this array still ends ''ok''. Excluded from the nightly '
  'backup by migration 018.';

COMMENT ON COLUMN public.strava_sync_state.backfill_cursor_before IS
  'Strava `before` epoch-seconds cursor, walking BACKWARDS through history. '
  'Written ONCE per run, at the end, in the same statement as the counters — '
  'never mid-walk. The importer collects pages and writes rows in two separate '
  'phases, so a cursor persisted mid-walk would describe rows that do not yet '
  'exist; a run killed in between would lose them permanently, because they '
  'sit below incremental_after and nothing would re-list them. An interrupted '
  'run instead re-walks from the last durable cursor, which is idempotent and '
  'costs one repeated page.';

COMMENT ON COLUMN public.strava_sync_state.purge_due_at IS
  'When the athlete''s Strava-derived data must be purged: set when Strava '
  'reports the grant revoked (purge 21 days later, owner decision on #628). '
  'NULL means no purge is scheduled. Set once and never pushed later; cleared '
  'by a reconnect. The purge is purge_strava_user (migration 019, #630).';

COMMENT ON COLUMN public.strava_sync_state.reconcile_due_at IS
  'When the next deletion-sync pass is due (Strava API Policy: deletions on '
  'Strava reflected within 48 hours). NULL means due now. Written by the '
  'reconcile pass inside strava-import (reconcile.ts, #630): +12 h after a '
  'completed pass, +1 h after an aborted one.';

-- ---------------------------------------------------------------------------
-- strava_session_links — provenance for every session the importer linked.
-- ---------------------------------------------------------------------------
-- One row per linked session, written in the same statement sequence as the
-- link itself by the two RPCs below and by nothing else. It answers the two
-- questions a later deletion (#630: disconnect, revocation purge, deletion
-- sync) has to answer exactly, and that sessions alone cannot:
--   1. Did the importer CREATE this row ('inserted' — delete it) or attach to a
--      row the athlete had filed ('adopted' — keep it, strip only what the
--      importer wrote)? sessions.source cannot say: six legacy rows carry
--      source = 'strava' from a hand import, and an adopted row keeps its own
--      source.
--   2. For an adopted row, which of avg_watts / avg_hr did the importer write,
--      and what had the athlete typed there before? wrote_* is set, and prior_*
--      captured, on the FIRST write of each column only, so a later re-import
--      can never overwrite the athlete's original value with Strava's.
-- device_name is kept so a Garmin-recorded activity can be found again when
-- Garmin attribution ships (#632).
--
-- Same privacy model as strava_tokens: RLS on, no policies, nothing granted to
-- anon or authenticated. The browser never reads it. Excluded from the nightly
-- backup by 018.
--
-- No separate index on user_id: the UNIQUE (user_id, strava_activity_id)
-- constraint's index leads with user_id and serves every per-user lookup.
CREATE TABLE IF NOT EXISTS public.strava_session_links (
  session_id         bigint PRIMARY KEY
                       REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  strava_activity_id bigint NOT NULL,
  origin             text NOT NULL,
  wrote_avg_watts    boolean NOT NULL DEFAULT false,
  prior_avg_watts    integer,
  wrote_avg_hr       boolean NOT NULL DEFAULT false,
  prior_avg_hr       integer,
  device_name        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strava_session_links_origin_known
    CHECK (origin IN ('inserted', 'adopted')),
  CONSTRAINT strava_session_links_user_activity_key
    UNIQUE (user_id, strava_activity_id)
);

ALTER TABLE public.strava_session_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.strava_session_links FROM public, anon, authenticated;

COMMENT ON TABLE public.strava_session_links IS
  'Provenance for every session the Strava importer linked: origin '
  '''inserted'' (the importer created the row) or ''adopted'' (it attached to '
  'a row the athlete filed), which of avg_watts / avg_hr it wrote, and the '
  'value the athlete had there before (prior_*, captured on the first write '
  'only, never overwritten). A deletion must use this to remove exactly what '
  'the importer wrote and restore what the athlete had typed: delete an '
  'inserted row; on an adopted row restore prior_* where wrote_* and clear '
  'strava_activity_id. Written only by upsert_strava_session and '
  'adopt_strava_session. DELIBERATELY POLICY-LESS (RLS enabled, no policies, '
  'no grants to anon or authenticated); excluded from the nightly backup by '
  'migration 018.';

-- ---------------------------------------------------------------------------
-- upsert_strava_session — insert-or-refresh a session from a Strava activity.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the callers are edge functions holding service_role,
-- and because concentrating the write here is what lets the column allow-list
-- below be enforced in one place instead of trusted to every call site.
--
-- `SET search_path = ''` with every reference schema-qualified, same reasoning
-- as 008: the body cannot be hijacked by a caller's search_path. pg_catalog is
-- searched implicitly even on an empty path, so coalesce/case/now need no
-- prefix.
--
-- PROCEDURAL, not INSERT ... ON CONFLICT, because the update branch now has to
-- read the link's origin before deciding what it may write, and a single
-- ON CONFLICT statement cannot read a second table inside DO UPDATE SET.
--
-- RACE SAFETY. Two runs importing the same activity at once:
--   * Update branch: the linked session is read FOR UPDATE, so the second run
--     blocks until the first commits and then works on the committed row
--     (Read Committed re-checks the row — transaction-iso.html, via Context7
--     /websites/postgresql). Exactly one session either way.
--   * Insert branch: both runs find no linked session and both INSERT. The
--     second blocks on 011's partial unique index sessions_user_strava_activity_key
--     until the first commits, then raises unique_violation. That error is
--     caught in a subtransaction (a PL/pgSQL block with an EXCEPTION clause
--     rolls back only its own changes — plpgsql-control-structures.html), the
--     loop goes round once more, finds the now-committed session and takes the
--     update branch. Still one row and no unhandled error. A unique_violation
--     that is NOT that (sessions_date_label_key: a same-date, same-label row
--     already exists) re-raises, which the caller has always treated as a
--     per-activity failure.
CREATE OR REPLACE FUNCTION public.upsert_strava_session(
  p_user_id     uuid,
  p_activity_id bigint,
  p_date        text,
  p_type        text,
  p_label       text,
  p_duration    text,
  p_distance_m  int,
  p_avg_watts   int,
  p_avg_hr      int,
  p_device_name text
)
RETURNS TABLE (session_id bigint, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sid    bigint;
  v_watts  int;
  v_hr     int;
  v_link   public.strava_session_links%ROWTYPE;
  v_try    int := 0;
BEGIN
  -- RACE GUARD (#630). A disconnect or revocation purge (019's
  -- purge_strava_user) locks this user's sync row FOR UPDATE, then deletes the
  -- importer's rows and the sync row in one transaction. An import already in
  -- flight could otherwise write a fresh link right after that commits and
  -- leave Strava data behind with nothing left to remove it. FOR SHARE blocks
  -- here until the purge commits, then re-checks the committed row (Read
  -- Committed): deleted, or no longer connected, means no row and P0003, which
  -- importer.ts treats as "connection gone" and stops the run. Lock order
  -- matches 019: sync row first, then sessions, then links.
  -- P0003 is also PL/pgSQL's built-in too_many_rows condition (SELECT INTO
  -- STRICT); neither RPC uses STRICT, so here it can only mean this guard.
  PERFORM 1 FROM public.strava_sync_state st
   WHERE st.user_id = p_user_id
     AND st.connected
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_strava_session: the Strava connection is gone (no connected strava_sync_state row)'
      USING ERRCODE = 'P0003';
  END IF;

  LOOP
    v_try := v_try + 1;

    SELECT s.id, s.avg_watts, s.avg_hr
      INTO v_sid, v_watts, v_hr
      FROM public.sessions s
     WHERE s.user_id = p_user_id
       AND s.strava_activity_id = p_activity_id
       FOR UPDATE;

    IF FOUND THEN
      SELECT l.* INTO v_link
        FROM public.strava_session_links l
       WHERE l.session_id = v_sid
         FOR UPDATE;
      IF NOT FOUND THEN
        -- Every link is written with its provenance row, in the same function
        -- call. A linked session without one means something wrote
        -- strava_activity_id outside these RPCs; refuse rather than guess
        -- whether this row's duration may be rewritten.
        RAISE EXCEPTION 'upsert_strava_session: session % is linked to activity % but has no strava_session_links row',
          v_sid, p_activity_id
          USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.sessions s SET
        -- GUARDED BY THE LINK'S ORIGIN, and this is not cosmetic.
        -- adopt_strava_session links a row the athlete filed by hand and
        -- deliberately does NOT touch duration or distance_m. But an adopted
        -- row is linked, so the NEXT run reaches it through this function, and
        -- an unguarded assignment here would undo that decision one cron cycle
        -- later: '60min' becomes '60:00', 9998 becomes 10000, and '9min'
        -- becomes '8:49' — which changes the parsed duration from 9.0 to 8.82
        -- minutes and therefore the load. A row we created may be corrected by
        -- a later run; a row we adopted may not.
        --
        -- The guard used to be `s.source = 'strava'`. That is wrong: six legacy
        -- rows carry source = 'strava' from a hand import, and once adopted
        -- they must keep their hand-filed duration and distance.
        duration   = CASE WHEN v_link.origin = 'inserted' THEN p_duration   ELSE s.duration   END,
        distance_m = CASE WHEN v_link.origin = 'inserted' THEN p_distance_m ELSE s.distance_m END,
        -- avg_watts/avg_hr are deliberately NOT guarded: enriching a linked row
        -- with device-measured power and heart rate is the Gate 1 decision.
        -- coalesce, not a bare assignment: a re-import from a payload that
        -- happens to lack power must not wipe a figure already recorded.
        avg_watts  = coalesce(p_avg_watts, s.avg_watts),
        avg_hr     = coalesce(p_avg_hr,    s.avg_hr)
      -- THE SET LIST ABOVE IS THE WHOLE CONTRACT. It must never grow to include
      -- date, label, type, status, source, srpe, coach_note, prs, exercises,
      -- coach_flag or benchmark_key. Two properties depend on that omission and
      -- nothing else enforces them:
      --   1. Re-import is idempotent even when the computed label differs (a
      --      renamed activity, or a change to buildLabel). Updating `label`
      --      would make every deploy of a new label format rewrite history —
      --      and could collide with sessions_date_label_key.
      --   2. coach_note survives by construction. The athlete's notes are the
      --      one thing in this table that cannot be re-derived from anywhere.
      -- `id` and `date_iso` are never named: id is an identity column and
      -- date_iso is GENERATED ALWAYS, so naming either is rejected outright.
       WHERE s.id = v_sid;

      -- Provenance: record a column as written, and capture what was there
      -- before, on the FIRST write only. Once wrote_* is true the prior value
      -- is never touched again, so a later re-import cannot replace the
      -- athlete's original figure with an earlier Strava one.
      UPDATE public.strava_session_links l SET
        wrote_avg_watts = l.wrote_avg_watts OR p_avg_watts IS NOT NULL,
        prior_avg_watts = CASE WHEN NOT l.wrote_avg_watts AND p_avg_watts IS NOT NULL
                               THEN v_watts ELSE l.prior_avg_watts END,
        wrote_avg_hr    = l.wrote_avg_hr OR p_avg_hr IS NOT NULL,
        prior_avg_hr    = CASE WHEN NOT l.wrote_avg_hr AND p_avg_hr IS NOT NULL
                               THEN v_hr ELSE l.prior_avg_hr END,
        device_name     = coalesce(p_device_name, l.device_name)
       WHERE l.session_id = v_sid;

      session_id := v_sid;
      action     := 'updated';
      RETURN NEXT;
      RETURN;
    END IF;

    BEGIN
      INSERT INTO public.sessions (
        user_id, strava_activity_id, date, type, label, duration,
        distance_m, avg_watts, avg_hr, status, source
      )
      VALUES (
        p_user_id, p_activity_id, p_date, p_type, p_label, p_duration,
        p_distance_m, p_avg_watts, p_avg_hr, 'completed', 'strava'
      )
      RETURNING id INTO v_sid;

      -- An inserted row has no athlete value underneath it, so prior_* stays
      -- NULL; wrote_* still records which columns the importer filled, for the
      -- same first-write rule above.
      INSERT INTO public.strava_session_links (
        session_id, user_id, strava_activity_id, origin,
        wrote_avg_watts, wrote_avg_hr, device_name
      )
      VALUES (
        v_sid, p_user_id, p_activity_id, 'inserted',
        p_avg_watts IS NOT NULL, p_avg_hr IS NOT NULL, p_device_name
      );

      session_id := v_sid;
      action     := 'inserted';
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Lost the insert race only if the activity is now linked; anything else
      -- (sessions_date_label_key) is a genuine failure and re-raises.
      IF v_try >= 2 OR NOT EXISTS (
        SELECT 1 FROM public.sessions s
         WHERE s.user_id = p_user_id
           AND s.strava_activity_id = p_activity_id
      ) THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.upsert_strava_session(uuid,bigint,text,text,text,text,int,int,int,text) IS
  'Insert a Strava activity as a session (with an ''inserted'' row in '
  'strava_session_links), or refresh the volatile metrics on the session '
  'already linked to it. duration and distance_m are refreshed ONLY when the '
  'link''s origin is ''inserted''; an adopted row keeps the duration and '
  'distance_m the athlete filed, for ever, whatever its sessions.source. '
  'avg_watts and avg_hr are enriched on every linked row (coalesce), and the '
  'link records the first write of each with the value it replaced. Returns '
  '(session_id, action) where action is ''inserted'' or ''updated''. Race-safe: '
  'a concurrent insert of the same activity is caught and retried as an '
  'update. A label colliding with an existing row on the same date raises '
  '23505 on sessions_date_label_key; callers treat that as a per-activity '
  'failure and continue. The SET list is deliberately minimal — see the '
  'inline comment; widening it breaks re-import idempotence and puts '
  'coach_note at risk. Raises P0003 when the user has no connected '
  'strava_sync_state row (disconnected or purged mid-run, #630).';

-- ---------------------------------------------------------------------------
-- adopt_strava_session — link an EXISTING session to a Strava activity.
-- ---------------------------------------------------------------------------
-- The single most consequential function in #54. Roughly twenty sessions
-- already in the table are the same training as a Strava activity, filed by
-- hand or by Coach under source portal/coach/coach_plan/claude_csv/concept2
-- (and six under 'strava', from a hand import). Importing those again would
-- double ten weeks of CTL/ATL/TSB. This links the existing row instead of
-- creating a second one, and records an 'adopted' link with the values it
-- replaced.
--
-- RACE SAFETY. The candidate is read FOR UPDATE with `strava_activity_id IS
-- NULL` in the WHERE: a second adopt of the same session blocks, then re-checks
-- the committed row, no longer matches, and returns 'adopt_lost_race'. If the
-- activity itself was meanwhile linked to a different session (a concurrent
-- insert), the UPDATE hits 011's partial unique index, or the link INSERT hits
-- strava_session_links_user_activity_key; both are caught in a subtransaction
-- that rolls back this call's writes, and the result is 'adopt_lost_race' too —
-- never two links for one activity, never an unhandled error.
CREATE OR REPLACE FUNCTION public.adopt_strava_session(
  p_user_id          uuid,
  p_session_id       bigint,
  p_activity_id      bigint,
  p_avg_watts        int,
  p_has_device_watts boolean,
  p_avg_hr           int,
  p_device_name      text
)
RETURNS TABLE (session_id bigint, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sid         bigint;
  v_prior_watts int;
  v_prior_hr    int;
  -- Power is written only when Strava says it came from a meter AND there is a
  -- number to write; heart rate only when there is one. Either way Strava wins
  -- over the athlete's figure (the approved behaviour), and the figure it
  -- replaced goes into the link so a deletion can restore it.
  v_write_watts boolean := coalesce(p_has_device_watts, false) AND p_avg_watts IS NOT NULL;
  v_write_hr    boolean := p_avg_hr IS NOT NULL;
BEGIN
  -- RACE GUARD (#630): see upsert_strava_session. Same lock, same SQLSTATE.
  PERFORM 1 FROM public.strava_sync_state st
   WHERE st.user_id = p_user_id
     AND st.connected
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adopt_strava_session: the Strava connection is gone (no connected strava_sync_state row)'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT s.id, s.avg_watts, s.avg_hr
    INTO v_sid, v_prior_watts, v_prior_hr
    FROM public.sessions s
   WHERE s.id = p_session_id
     AND s.user_id = p_user_id
     -- The race guard, not a filter: a row already claimed is never re-pointed
     -- at a different activity.
     AND s.strava_activity_id IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    session_id := p_session_id;
    action     := 'adopt_lost_race';
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    -- EXACTLY THREE COLUMNS. Not duration, not distance_m, not label, not
    -- date, not source, and absolutely not coach_note. The existing row is the
    -- record of what the athlete decided the session was; adoption only adds
    -- the machine facts they could not have known. Not touching `source` keeps
    -- this independent of upsert_strava_session's guard, which reads the
    -- link's origin, not source.
    UPDATE public.sessions s SET
      strava_activity_id = p_activity_id,
      avg_watts = CASE WHEN v_write_watts THEN p_avg_watts ELSE s.avg_watts END,
      avg_hr    = CASE WHEN v_write_hr    THEN p_avg_hr    ELSE s.avg_hr    END
     WHERE s.id = v_sid;

    INSERT INTO public.strava_session_links (
      session_id, user_id, strava_activity_id, origin,
      wrote_avg_watts, prior_avg_watts, wrote_avg_hr, prior_avg_hr, device_name
    )
    VALUES (
      v_sid, p_user_id, p_activity_id, 'adopted',
      v_write_watts, CASE WHEN v_write_watts THEN v_prior_watts END,
      v_write_hr,    CASE WHEN v_write_hr    THEN v_prior_hr    END,
      p_device_name
    );
  EXCEPTION WHEN unique_violation THEN
    session_id := p_session_id;
    action     := 'adopt_lost_race';
    RETURN NEXT;
    RETURN;
  END;

  session_id := v_sid;
  action     := 'adopted';
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.adopt_strava_session(uuid,bigint,bigint,int,boolean,int,text) IS
  'Link an existing session to a Strava activity without rewriting what the '
  'athlete logged. Touches exactly three sessions columns: strava_activity_id, '
  'avg_watts (only when p_has_device_watts and a value is given) and avg_hr '
  '(only when a value is given), and writes an ''adopted'' strava_session_links '
  'row recording which of the two it wrote and the value each replaced. '
  'Returns action ''adopted'', or ''adopt_lost_race'' when the row or the '
  'activity was already claimed — zero rows updated is a reportable outcome, '
  'never a silent success. Raises P0003 when the user has no connected '
  'strava_sync_state row (disconnected or purged mid-run, #630).';

-- ---------------------------------------------------------------------------
-- Grants. See the header: revoking from PUBLIC is the half that matters.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.upsert_strava_session(uuid,bigint,text,text,text,text,int,int,int,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_strava_session(uuid,bigint,text,text,text,text,int,int,int,text)
  TO service_role;

REVOKE ALL ON FUNCTION public.adopt_strava_session(uuid,bigint,bigint,int,boolean,int,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_strava_session(uuid,bigint,bigint,int,boolean,int,text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Assertions. A regression here is silent and catastrophic — a SECURITY
-- DEFINER function reachable by `anon` writes sessions for any user_id the
-- caller names. Fail the migration loudly instead. `raise exception`, not
-- ASSERT: plpgsql.check_asserts can switch ASSERT off (same reasoning as 014
-- and 017).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn  text;
  v_rel text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.upsert_strava_session(uuid,bigint,text,text,text,text,int,int,int,text)',
    'public.adopt_strava_session(uuid,bigint,bigint,int,boolean,int,text)'
  ] LOOP
    IF has_function_privilege('public', v_fn, 'execute')
       OR has_function_privilege('anon', v_fn, 'execute')
       OR has_function_privilege('authenticated', v_fn, 'execute')
       OR NOT has_function_privilege('service_role', v_fn, 'execute') THEN
      RAISE EXCEPTION '012: % has wrong EXECUTE (want public/anon/authenticated false, service_role true)', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn::regprocedure
                      AND p.prosecdef
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '012: % is not SECURITY DEFINER with search_path=""', v_fn;
    END IF;
  END LOOP;

  -- No function of either name may survive under another signature: an old
  -- overload would be a second, provenance-free write path.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('upsert_strava_session', 'adopt_strava_session')) <> 2 THEN
    RAISE EXCEPTION '012: an extra overload of upsert_strava_session/adopt_strava_session exists';
  END IF;

  FOREACH v_rel IN ARRAY ARRAY['strava_tokens', 'strava_oauth_state', 'strava_session_links'] LOOP
    IF has_table_privilege('anon', 'public.' || v_rel, 'select')
       OR has_table_privilege('authenticated', 'public.' || v_rel, 'select')
       OR has_table_privilege('authenticated', 'public.' || v_rel, 'insert')
       OR has_table_privilege('authenticated', 'public.' || v_rel, 'update')
       OR has_table_privilege('authenticated', 'public.' || v_rel, 'delete') THEN
      RAISE EXCEPTION '012: a browser role holds a privilege on public.%', v_rel;
    END IF;
    -- Policy-less is the privacy model; a policy here is a regression.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies pol
                WHERE pol.schemaname = 'public' AND pol.tablename = v_rel) THEN
      RAISE EXCEPTION '012: public.% has a row-level security policy; it must have none', v_rel;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
             WHERE c.oid = ('public.' || v_rel)::regclass) THEN
      RAISE EXCEPTION '012: public.% does not have row level security enabled', v_rel;
    END IF;
  END LOOP;

  -- 017's invariant: FORCE binds no BYPASSRLS role and would make the backup
  -- export only policy-visible rows. None of ours may carry it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
              WHERE c.relnamespace = 'public'::regnamespace
                AND c.relname LIKE 'strava\_%'
                AND c.relkind IN ('r', 'p')
                AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION '012: a strava_* table has FORCE ROW LEVEL SECURITY';
  END IF;

  IF has_table_privilege('authenticated', 'public.strava_sync_state', 'update') THEN
    RAISE EXCEPTION '012: authenticated can update strava_sync_state';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.strava_sync_state', 'select') THEN
    RAISE EXCEPTION '012: authenticated cannot select strava_sync_state';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Self-test of both RPCs. Nothing else exercises this PL/pgSQL before
-- production: the Deno tests drive a fake client and a dry run makes no RPC
-- call. Everything runs inside an inner block that ALWAYS ends by raising the
-- sentinel SQLSTATE 'SF012', which its own EXCEPTION clause catches; a block
-- with an EXCEPTION clause is a subtransaction, so catching the sentinel rolls
-- back every row written inside it (plpgsql-control-structures.html § Trapping
-- Errors, via Context7 /websites/postgresql). A failed check raises P0001
-- instead, which the sentinel handler does not catch, so it fails the whole
-- migration.
--
-- Synthetic data only: a random user_id (sessions.user_id has no foreign key,
-- verified in pg_constraint), labels carrying a random suffix, and a date
-- ('1/1/00' = 2000-01-01) no real row is near. No real row is read or printed.
-- Side effect: the sessions identity sequence advances by the rows inserted
-- here (sequences do not roll back); ids are not meaningful, so that is
-- harmless.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_tag    text := replace(gen_random_uuid()::text, '-', '');
  v_date   text := '1/1/00';
  v_a_ins  bigint := 900000000001;  -- inserted by the importer
  v_a_adp  bigint := 900000000002;  -- adopted onto a hand-filed row
  v_a_adp2 bigint := 900000000003;  -- adopted with nothing written, enriched later
  v_a_race bigint := 900000000004;  -- a second adopt of an already-linked row
  v_sid    bigint;
  v_sid2   bigint;
  v_hand   bigint;
  v_hand2  bigint;
  v_hand3  bigint;
  v_action text;
  v_s      record;
  v_l      record;
  v_n      bigint;
  v_other  uuid := gen_random_uuid();  -- a user with no sync row at all
  v_raised boolean;
BEGIN
  BEGIN
    -- 0. The race guard (#630) requires a connected sync row before either RPC
    --    will write. strava_sync_state.user_id has no foreign key, so a random
    --    user is fine; backfill_from is the only other NOT NULL column.
    INSERT INTO public.strava_sync_state (user_id, connected, backfill_from)
    VALUES (v_user, true, DATE '2000-01-01');

    -- 1. Insert: a new session and an 'inserted' link.
    SELECT r.session_id, r.action INTO v_sid, v_action
      FROM public.upsert_strava_session(v_user, v_a_ins, v_date, 'erg',
             'strava-012-selftest-ins-' || v_tag, '25:00', 6000, 150, 130, 'Concept2 PM5') r;
    IF v_action IS DISTINCT FROM 'inserted' THEN
      RAISE EXCEPTION '012 self-test: first upsert returned %, want inserted', v_action;
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_sid;
    SELECT * INTO v_l FROM public.strava_session_links l WHERE l.session_id = v_sid;
    IF v_s.strava_activity_id IS DISTINCT FROM v_a_ins OR v_s.source IS DISTINCT FROM 'strava'
       OR v_s.duration IS DISTINCT FROM '25:00' OR v_s.distance_m IS DISTINCT FROM 6000 THEN
      RAISE EXCEPTION '012 self-test: inserted session has the wrong shape';
    END IF;
    IF v_l.origin IS DISTINCT FROM 'inserted' OR v_l.user_id IS DISTINCT FROM v_user
       OR v_l.strava_activity_id IS DISTINCT FROM v_a_ins
       OR v_l.device_name IS DISTINCT FROM 'Concept2 PM5'
       OR v_l.prior_avg_watts IS NOT NULL OR v_l.prior_avg_hr IS NOT NULL THEN
      RAISE EXCEPTION '012 self-test: insert did not write an ''inserted'' link';
    END IF;

    -- 2. Re-upsert of the same activity: same row, duration/distance refreshed.
    SELECT r.session_id, r.action INTO v_sid2, v_action
      FROM public.upsert_strava_session(v_user, v_a_ins, v_date, 'erg',
             'strava-012-selftest-renamed-' || v_tag, '25:30', 6100, 155, 131, 'Concept2 PM5') r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_sid;
    SELECT count(*) INTO v_n FROM public.sessions s
     WHERE s.user_id = v_user AND s.strava_activity_id = v_a_ins;
    IF v_action IS DISTINCT FROM 'updated' OR v_sid2 IS DISTINCT FROM v_sid OR v_n <> 1
       OR v_s.duration IS DISTINCT FROM '25:30' OR v_s.distance_m IS DISTINCT FROM 6100
       OR v_s.label IS DISTINCT FROM 'strava-012-selftest-ins-' || v_tag THEN
      RAISE EXCEPTION '012 self-test: re-upsert of an inserted activity did not refresh the same row (action %, rows %)', v_action, v_n;
    END IF;

    -- 3. Adopt a hand-filed row. source = 'strava' on purpose: six legacy rows
    --    carry it, and the guard must hold for them too.
    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m,
                                 avg_watts, avg_hr, status, source, coach_note)
    VALUES (v_user, v_date, 'Z2 Aerobic', 'strava-012-selftest-hand-' || v_tag, '25min',
            6002, 140, NULL, 'completed', 'strava', 'selftest note')
    RETURNING id INTO v_hand;

    SELECT r.session_id, r.action INTO v_sid2, v_action
      FROM public.adopt_strava_session(v_user, v_hand, v_a_adp, 150, true, 130, 'Zwift') r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand;
    SELECT * INTO v_l FROM public.strava_session_links l WHERE l.session_id = v_hand;
    IF v_action IS DISTINCT FROM 'adopted' OR v_sid2 IS DISTINCT FROM v_hand THEN
      RAISE EXCEPTION '012 self-test: adopt returned %', v_action;
    END IF;
    IF v_s.strava_activity_id IS DISTINCT FROM v_a_adp
       OR v_s.avg_watts IS DISTINCT FROM 150 OR v_s.avg_hr IS DISTINCT FROM 130
       OR v_s.duration IS DISTINCT FROM '25min' OR v_s.distance_m IS DISTINCT FROM 6002
       OR v_s.label IS DISTINCT FROM 'strava-012-selftest-hand-' || v_tag
       OR v_s.date IS DISTINCT FROM v_date OR v_s.source IS DISTINCT FROM 'strava'
       OR v_s.coach_note IS DISTINCT FROM 'selftest note' THEN
      RAISE EXCEPTION '012 self-test: adopt touched a column it must not, or missed one it must write';
    END IF;
    IF v_l.origin IS DISTINCT FROM 'adopted'
       OR v_l.wrote_avg_watts IS DISTINCT FROM true OR v_l.prior_avg_watts IS DISTINCT FROM 140
       OR v_l.wrote_avg_hr IS DISTINCT FROM true OR v_l.prior_avg_hr IS NOT NULL
       OR v_l.device_name IS DISTINCT FROM 'Zwift' THEN
      RAISE EXCEPTION '012 self-test: adopted link has wrong wrote_*/prior_*';
    END IF;

    -- 4. A later upsert of the adopted activity: duration/distance untouched,
    --    watts enriched, prior value NOT overwritten.
    SELECT r.session_id, r.action INTO v_sid2, v_action
      FROM public.upsert_strava_session(v_user, v_a_adp, v_date, 'erg',
             'strava-012-selftest-other-' || v_tag, '25:01', 6005, 160, 132, 'Zwift') r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand;
    SELECT * INTO v_l FROM public.strava_session_links l WHERE l.session_id = v_hand;
    IF v_action IS DISTINCT FROM 'updated' OR v_sid2 IS DISTINCT FROM v_hand
       OR v_s.duration IS DISTINCT FROM '25min' OR v_s.distance_m IS DISTINCT FROM 6002
       OR v_s.label IS DISTINCT FROM 'strava-012-selftest-hand-' || v_tag
       OR v_s.avg_watts IS DISTINCT FROM 160 OR v_s.avg_hr IS DISTINCT FROM 132 THEN
      RAISE EXCEPTION '012 self-test: upsert of an adopted activity rewrote duration/distance or failed to enrich';
    END IF;
    IF v_l.prior_avg_watts IS DISTINCT FROM 140 OR v_l.prior_avg_hr IS NOT NULL
       OR v_l.wrote_avg_watts IS DISTINCT FROM true OR v_l.wrote_avg_hr IS DISTINCT FROM true THEN
      RAISE EXCEPTION '012 self-test: a re-import overwrote a captured prior value';
    END IF;

    -- 5. Adopt with nothing to write, then enrich: prior captured at the
    --    first false -> true transition, and only then.
    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m,
                                 avg_watts, avg_hr, status, source)
    VALUES (v_user, v_date, 'Cycling', 'strava-012-selftest-hand2-' || v_tag, '60min',
            22900, 180, 120, 'completed', 'portal')
    RETURNING id INTO v_hand2;
    SELECT r.action INTO v_action
      FROM public.adopt_strava_session(v_user, v_hand2, v_a_adp2, NULL, false, NULL, NULL) r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand2;
    SELECT * INTO v_l FROM public.strava_session_links l WHERE l.session_id = v_hand2;
    IF v_action IS DISTINCT FROM 'adopted' OR v_s.avg_watts IS DISTINCT FROM 180
       OR v_s.avg_hr IS DISTINCT FROM 120
       OR v_l.wrote_avg_watts OR v_l.wrote_avg_hr
       OR v_l.prior_avg_watts IS NOT NULL OR v_l.prior_avg_hr IS NOT NULL THEN
      RAISE EXCEPTION '012 self-test: an adopt with no device values wrote something';
    END IF;
    PERFORM public.upsert_strava_session(v_user, v_a_adp2, v_date, 'cycling',
              'strava-012-selftest-x-' || v_tag, '59:00', 22870, 200, NULL, NULL);
    PERFORM public.upsert_strava_session(v_user, v_a_adp2, v_date, 'cycling',
              'strava-012-selftest-x-' || v_tag, '59:00', 22870, 210, 125, NULL);
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand2;
    SELECT * INTO v_l FROM public.strava_session_links l WHERE l.session_id = v_hand2;
    IF v_s.avg_watts IS DISTINCT FROM 210 OR v_s.avg_hr IS DISTINCT FROM 125
       OR v_s.duration IS DISTINCT FROM '60min' OR v_s.distance_m IS DISTINCT FROM 22900
       OR v_l.wrote_avg_watts IS DISTINCT FROM true OR v_l.prior_avg_watts IS DISTINCT FROM 180
       OR v_l.wrote_avg_hr IS DISTINCT FROM true OR v_l.prior_avg_hr IS DISTINCT FROM 120 THEN
      RAISE EXCEPTION '012 self-test: first-write prior capture is wrong (watts prior %, hr prior %)',
        v_l.prior_avg_watts, v_l.prior_avg_hr;
    END IF;

    -- 6. A second adopt of an already-linked session is refused.
    SELECT r.action INTO v_action
      FROM public.adopt_strava_session(v_user, v_hand, v_a_race, 999, true, 199, NULL) r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand;
    IF v_action IS DISTINCT FROM 'adopt_lost_race' OR v_s.strava_activity_id IS DISTINCT FROM v_a_adp
       OR v_s.avg_watts IS DISTINCT FROM 160
       OR EXISTS (SELECT 1 FROM public.strava_session_links l
                   WHERE l.user_id = v_user AND l.strava_activity_id = v_a_race) THEN
      RAISE EXCEPTION '012 self-test: a second adopt of a linked session was not refused (%)', v_action;
    END IF;

    -- 7. Adopting an activity that is already linked elsewhere is refused too
    --    (the unique-violation path), leaving the candidate untouched.
    INSERT INTO public.sessions (user_id, date, type, label, duration, distance_m,
                                 avg_watts, status, source)
    VALUES (v_user, v_date, 'erg', 'strava-012-selftest-hand3-' || v_tag, '25min',
            6000, 141, 'completed', 'portal')
    RETURNING id INTO v_hand3;
    SELECT r.action INTO v_action
      FROM public.adopt_strava_session(v_user, v_hand3, v_a_ins, 150, true, 130, NULL) r;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_hand3;
    IF v_action IS DISTINCT FROM 'adopt_lost_race' OR v_s.strava_activity_id IS NOT NULL
       OR v_s.avg_watts IS DISTINCT FROM 141
       OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.session_id = v_hand3) THEN
      RAISE EXCEPTION '012 self-test: adopting an already-linked activity was not refused cleanly (%)', v_action;
    END IF;

    SELECT count(*) INTO v_n FROM public.strava_session_links l WHERE l.user_id = v_user;
    IF v_n <> 3 THEN
      RAISE EXCEPTION '012 self-test: % links, want 3', v_n;
    END IF;

    -- 8. The race guard (#630): no connected sync row, no write. Each call sits
    --    in its own block that catches ONLY P0003; the "did not raise" check
    --    raises P0001 after the block, which nothing here catches, so it fails
    --    the migration.
    --    (a) a user with no sync row at all, both RPCs;
    v_raised := false;
    BEGIN
      PERFORM public.upsert_strava_session(v_other, 900000000005, v_date, 'erg',
                'strava-012-selftest-nostate-' || v_tag, '25:00', 6000, 150, 130, NULL);
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '012 self-test: upsert_strava_session wrote for a user with no sync row (want P0003)';
    END IF;
    v_raised := false;
    BEGIN
      PERFORM public.adopt_strava_session(v_other, v_hand3, 900000000006, 150, true, 130, NULL);
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '012 self-test: adopt_strava_session wrote for a user with no sync row (want P0003)';
    END IF;

    --    (b) this user, disconnected: both RPCs refuse, even on a linked row.
    UPDATE public.strava_sync_state st SET connected = false WHERE st.user_id = v_user;
    v_raised := false;
    BEGIN
      PERFORM public.upsert_strava_session(v_user, v_a_ins, v_date, 'erg',
                'strava-012-selftest-ins-' || v_tag, '26:00', 6200, 170, 140, NULL);
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '012 self-test: upsert_strava_session wrote while disconnected (want P0003)';
    END IF;
    v_raised := false;
    BEGIN
      PERFORM public.adopt_strava_session(v_user, v_hand3, 900000000007, 150, true, 130, NULL);
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION '012 self-test: adopt_strava_session wrote while disconnected (want P0003)';
    END IF;
    SELECT * INTO v_s FROM public.sessions s WHERE s.id = v_sid;
    IF v_s.duration IS DISTINCT FROM '25:30' OR v_s.avg_watts IS DISTINCT FROM 155
       OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = v_other)
       OR (SELECT count(*) FROM public.strava_session_links l WHERE l.user_id = v_user) <> 3 THEN
      RAISE EXCEPTION '012 self-test: a refused (P0003) call changed a row';
    END IF;

    RAISE EXCEPTION 'rollback' USING ERRCODE = 'SF012';
  EXCEPTION WHEN SQLSTATE 'SF012' THEN
    NULL;  -- the sentinel: everything above is rolled back
  END;

  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id IN (v_user, v_other))
     OR EXISTS (SELECT 1 FROM public.strava_session_links l WHERE l.user_id IN (v_user, v_other))
     OR EXISTS (SELECT 1 FROM public.strava_sync_state st WHERE st.user_id IN (v_user, v_other)) THEN
    RAISE EXCEPTION '012 self-test: synthetic rows survived the rollback';
  END IF;

  RAISE NOTICE '012: RPC self-test passed (insert, refresh, adopt, adopted-row guard, first-write prior capture, two refusals, P0003 race guard); all synthetic rows rolled back';
END $$;
