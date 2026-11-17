// disconnect.ts — the two disconnect actions of strava-connect (#630), split out
// of index.ts so they can be driven by a fake client in strava-connect/test.ts.
//
// Disconnect DELETES what Strava gave us: the importer's own rows go, rows the
// athlete added to keep their own sRPE or notes but lose Strava's power and
// heart rate, rows the athlete filed and the importer adopted get the athlete's
// own figures back, and the token, OAuth state and sync rows are removed. All of
// that is one call to purge_strava_user (migration 019), one transaction.
//
// Type-only supabase-js import, for the reason strava-import/importer.ts gives:
// the test must not need jsr.io in its module graph.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createSupabaseTokenStore } from "../strava-import/importer.ts";
import { getFreshAccessToken, type RefreshFn, type TokenStore } from "../strava-import/tokens.ts";
import { captureFunctionError } from "../_shared/sentry.ts";

const FN = "strava-connect";

export type DisconnectPreview = { toDelete: number; toKeep: number; toRestore: number; toUnlink: number };
export type Revocation = "revoked" | "failed" | "not_attempted";

export type PreviewResult =
  | { ok: true; preview: DisconnectPreview }
  | { ok: false; error: "disconnect_preview_failed" };

export type ConfirmResult =
  | { ok: true; removed: number; kept: number; restored: number; unlinked: number; revocation: Revocation }
  | { ok: false; error: "disconnect_failed" };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * What a disconnect would do, counted by the same function that will do it
 * (purge_strava_user with p_dry_run). No Strava call and no write. Orphans — a
 * session carrying a Strava id with no provenance row — are kept and unlinked;
 * they are counted apart (toUnlink), since unlike `toKeep` they keep Strava's
 * figures and lose only the link.
 */
export async function previewDisconnect(deps: { supa: SupabaseClient; userId: string }): Promise<PreviewResult> {
  const { supa, userId } = deps;
  const { data, error } = await supa.rpc("purge_strava_user", {
    p_user_id: userId,
    p_reason: "disconnect",
    p_dry_run: true,
  });
  if (error) {
    await captureFunctionError(FN, new Error(`purge_strava_user preview failed: ${error.code ?? "unknown"}`), {
      userId,
      stage: "preview",
    });
    return { ok: false, error: "disconnect_preview_failed" };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    preview: {
      toDelete: num(o.deleted),
      toKeep: num(o.kept),
      toRestore: num(o.restored),
      toUnlink: num(o.orphans_unlinked),
    },
  };
}

export type ConfirmDeps = {
  supa: SupabaseClient;
  userId: string;
  refresh: RefreshFn;
  /** client.ts deauthorize, or a test double. Must resolve false (never throw) on failure. */
  deauthorize: (accessToken: string) => Promise<boolean>;
  now?: () => number;
  /** Test seam; defaults to the Supabase-backed store. */
  store?: TokenStore;
};

/**
 * The disconnect itself, in the order that keeps every failure safe:
 *
 *  1. Get a live access token FIRST, while we still hold the refresh token —
 *     after the purge there is nothing left to revoke with. The store's
 *     `remove` is a no-op: getFreshAccessToken deletes the token row on a second
 *     invalid_grant, and here only the purge may delete it, in its transaction.
 *  2. Purge. If it fails nothing has changed: report 502 and do NOT revoke at
 *     Strava, or the athlete would be left with a dead grant and every row
 *     still in place.
 *  3. Only then revoke at Strava, best effort, with a timeout. A failure is
 *     reported to the athlete (`failed`) and to Sentry; the local data is gone
 *     either way. A token that could not be read or refreshed in step 1 is also
 *     `failed`: the grant may still stand. `not_attempted` means the grant was
 *     already dead (auth_failed) or never existed (not_connected).
 */
export async function confirmDisconnect(deps: ConfirmDeps): Promise<ConfirmResult> {
  const { supa, userId, refresh, deauthorize } = deps;
  const now = deps.now ?? (() => Date.now());
  const base = deps.store ?? createSupabaseTokenStore(supa);
  const keepRow: TokenStore = { read: base.read, rotate: base.rotate, remove: () => Promise.resolve() };

  let accessToken: string | null = null;
  // True when we could not learn whether the grant still stands: the athlete
  // must be told revocation failed, never that access had already ended.
  let tokenUnknown = false;
  try {
    const token = await getFreshAccessToken(keepRow, refresh, userId, now());
    if (token.status === "ok") accessToken = token.accessToken;
    else if (token.status === "refresh_failed") {
      // Strava unreachable: the grant may still stand and cannot be revoked now.
      tokenUnknown = true;
      await captureFunctionError(FN, new Error("strava token refresh failed at disconnect"), {
        userId,
        stage: "token",
      });
    }
    // auth_failed / not_connected: the grant is already dead, nothing to revoke.
  } catch (e) {
    tokenUnknown = true;
    await captureFunctionError(FN, e, { userId, stage: "token" });
  }

  const { data, error } = await supa.rpc("purge_strava_user", {
    p_user_id: userId,
    p_reason: "disconnect",
    p_dry_run: false,
  });
  if (error) {
    await captureFunctionError(FN, new Error(`purge_strava_user failed: ${error.code ?? "unknown"}`), {
      userId,
      stage: "purge",
    });
    return { ok: false, error: "disconnect_failed" };
  }
  const o = (data ?? {}) as Record<string, unknown>;

  // not_attempted only when the grant is known to be dead (auth_failed) or
  // there was none (not_connected).
  let revocation: Revocation = tokenUnknown ? "failed" : "not_attempted";
  if (accessToken) {
    const accepted = await deauthorize(accessToken);
    revocation = accepted ? "revoked" : "failed";
    if (!accepted) {
      await captureFunctionError(FN, new Error("strava deauthorize not confirmed"), { userId, stage: "deauthorize" });
    }
  }

  return {
    ok: true,
    removed: num(o.deleted),
    kept: num(o.kept),
    restored: num(o.restored),
    unlinked: num(o.orphans_unlinked),
    revocation,
  };
}

export type ActionResponse = { status: number; body: Record<string, unknown> };

/**
 * The HTTP contract of the two disconnect actions (frozen for the dashboard,
 * #630 spec §3.1). Returns null for any other action. index.ts adds CORS and
 * serialises; keeping the mapping here is what lets the test pin it.
 */
export async function routeDisconnect(action: string, confirm: boolean, deps: ConfirmDeps): Promise<ActionResponse | null> {
  if (action === "disconnect_preview") {
    const r = await previewDisconnect(deps);
    return r.ok ? { status: 200, body: { ok: true, preview: r.preview } } : { status: 502, body: { error: r.error } };
  }
  if (action === "disconnect") {
    // Checked before any read or Strava call: without it nothing happens.
    if (!confirm) return { status: 400, body: { error: "confirm_required" } };
    const r = await confirmDisconnect(deps);
    if (!r.ok) return { status: 502, body: { error: r.error } };
    // revocation 'failed' means our data is gone but the grant may still stand
    // at Strava; the dashboard tells the athlete to remove the app there.
    return {
      status: 200,
      body: {
        ok: true,
        disconnected: true,
        removed: r.removed,
        kept: r.kept,
        restored: r.restored,
        unlinked: r.unlinked,
        revocation: r.revocation,
      },
    };
  }
  return null;
}
