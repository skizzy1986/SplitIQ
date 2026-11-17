// syncState.ts — the strava_sync_state row a successful connect writes, pure so
// it can be tested without the handler (strava-connect/test.ts imports it).

export type ConnectedPatchInput = {
  userId: string;
  athleteId: number;
  scope: string;
  nowISO: string;
  backfillFrom: string;
};

/**
 * Upserted on every successful callback.
 *
 * A reconnect CANCELS a scheduled revocation purge (#630): purge_due_at goes
 * back to null, and last_run_status / last_error_code are cleared so the panel
 * stops showing the auth failure that scheduled it. (purge_strava_user also
 * refuses a revocation purge while a token newer than the disconnect exists,
 * which covers a purge racing this upsert.)
 *
 * Cursors and rate_limit_resets_at are deliberately NOT in this object:
 * reconnecting the same athlete after an accidental disconnect should resume,
 * not re-walk ten weeks, and a pending rate-limit hold still applies.
 */
export function connectedSyncStatePatch(input: ConnectedPatchInput): Record<string, unknown> {
  return {
    user_id: input.userId,
    connected: true,
    athlete_id: input.athleteId,
    scope: input.scope,
    connected_at: input.nowISO,
    disconnected_at: null,
    backfill_from: input.backfillFrom,
    purge_due_at: null,
    last_run_status: null,
    last_error_code: null,
    updated_at: input.nowISO,
  };
}
