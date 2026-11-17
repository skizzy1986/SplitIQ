// reconcile.ts — the deletion sync (#630). Strava's API Policy requires that an
// activity the athlete deletes on Strava is reflected here within 48 hours. The
// pass runs INSIDE runImport, after the import's writes (Gate 2 decision on
// #628), at most every RECONCILE_INTERVAL_MS per athlete:
//
//   1. read the athlete's links (strava_link_inventory, migration 019);
//   2. list every Strava activity in the window those links span;
//   3. a link whose activity was NOT listed is only a CANDIDATE — a listing can
//      be short for reasons that have nothing to do with deletion — so each
//      candidate's detail is fetched, and only a 404 confirms it gone;
//   4. purge_strava_activities removes exactly what the importer wrote for the
//      confirmed ones (delete an inserted row with no athlete data; otherwise
//      restore the athlete's values and unlink).
//
// THE SAFETY PROPERTY: every abort happens BEFORE the delete RPC. A listing
// that fails, comes back malformed or empty, is cut short by the budget, or
// names suspiciously many links missing (the cap), deletes nothing; so does a
// detail fetch that answers anything but 200 or 404. A wrong deletion of a
// session is unrecoverable, a late one is retried an hour later.
//
// Type-only supabase-js import, for the reason importer.ts gives.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  EMPTY_RATE_LIMIT,
  getActivity,
  listActivities,
  StravaAuthError,
  StravaHttpError,
  StravaRateLimitError,
  type RateLimit,
} from "./client.ts";
import {
  isDailyCapExhausted,
  nextQuarterHour,
  nextUtcMidnight,
  RECONCILE_BUDGET,
  RECONCILE_STOP_FRACTION,
  revokedPatch,
  shouldStopChunk,
  type ChunkBudget,
} from "./state.ts";
import { captureFunctionError } from "../_shared/sentry.ts";

const FN = "strava-import";
const PER_PAGE = 100;
const HOUR_MS = 60 * 60 * 1000;

/** A completed pass is due again 12 hours later: two chances inside Strava's 48. */
export const RECONCILE_INTERVAL_MS = 12 * HOUR_MS;
/** An aborted pass retries after an hour (Gate 2, Q-C). */
export const RECONCILE_RETRY_MS = HOUR_MS;
/**
 * A pass whose due time is at most this far ahead still runs. Smaller than the
 * 15-minute cron tick, so it only absorbs scheduling jitter: without it a pass
 * due at 12:00:30 would wait for the 12:15 run.
 */
export const RECONCILE_DUE_SLACK_MS = 5 * 60 * 1000;
/**
 * Days listed BEFORE the earliest link date. A link's date is the activity's
 * LOCAL date and Strava's `after` is a UTC instant; an activity 23:30 local in
 * UTC+14 starts the previous UTC day, so a window starting exactly on the local
 * date would miss it and call it deleted. Two days covers every offset.
 */
export const WINDOW_MARGIN_DAYS = 2;
/** The cap never drops below this many candidates... */
export const CAP_MIN = 3;
/** ...and is otherwise this fraction of the links inside the window. */
export const CAP_FRACTION = 0.2;
/** Each Strava request in the pass gives up after this long. */
export const STRAVA_TIMEOUT_MS = 10_000;

export type ReconcileStatus =
  | "ok"
  | "noop"
  | "not_due"
  | "skipped_rate_limited"
  | "truncated"
  | "listing_failed"
  | "listing_empty"
  | "listing_malformed"
  | "capped"
  | "detail_failed"
  | "auth_failed"
  | "error";

/** Statuses that ended the pass before it could finish; the next try is an hour out. */
const ABORTS: ReadonlySet<ReconcileStatus> = new Set<ReconcileStatus>([
  "truncated",
  "listing_failed",
  "listing_malformed",
  "listing_empty",
  "capped",
  "detail_failed",
  "error",
]);

export type ReconcileDecision = {
  activityId: number;
  action: "delete" | "keep_unlink" | "restore_unlink" | "keep_present";
};

export type ReconcileResult = {
  ok: boolean;
  status: ReconcileStatus;
  /** A short machine reason for the status, never free text from an upstream. */
  reason: string | null;
  links: number;
  listed: number;
  candidates: number;
  cap: number;
  confirmedGone: number;
  deleted: number;
  keptUnlinked: number;
  restored: number;
  stravaCalls: number;
  /** Per-activity outcome. DRY RUN ONLY: a real run returns counts, never activity ids (Gate 2, Q-D). */
  decisions?: ReconcileDecision[];
};

export type LinkRow = {
  session_id: number;
  strava_activity_id: number;
  /** sessions.date_iso — the generated DATE, never the text `date`. */
  date_iso: string | null;
  link_created_at: string;
};

export type ReconcileSync = {
  connected: boolean;
  backfill_from?: string | null;
  reconcile_due_at?: string | null;
  rate_limit_resets_at?: string | null;
  purge_due_at?: string | null;
};

export type ReconcileDeps = {
  supa: SupabaseClient;
  /** The live access token runImport already holds; the pass never fetches its own. */
  accessToken: string;
  /** STRAVA_BACKFILL_FROM, used when the sync row carries no backfill_from. */
  backfillFrom: string;
  now?: () => number;
  /** Already reduced by runImport to what is left of the run's own budget. */
  budget?: ChunkBudget;
  /** The import's last-seen quota, so a nearly spent window stops the pass before its first call. */
  rateLimit?: RateLimit;
  /** Test seam; production uses STRAVA_TIMEOUT_MS. */
  timeoutMs?: number;
};

export type ReconcileOptions = {
  userId: string;
  mode: "cron" | "user";
  dryRun: boolean;
  sync: ReconcileSync;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The first date the listing must cover: min(earliest link date, backfill_from) minus the margin. */
export function reconcileWindowStartISO(dateIsos: (string | null)[], backfillFrom: string): string {
  // ISO dates order correctly as strings.
  let earliest = backfillFrom;
  for (const d of dateIsos) if (typeof d === "string" && d < earliest) earliest = d;
  return shiftISO(earliest, -WINDOW_MARGIN_DAYS);
}

/** Strava's `after` for the listing: the window start as UTC epoch seconds. */
export function reconcileWindowAfter(dateIsos: (string | null)[], backfillFrom: string): number {
  const [y, m, d] = reconcileWindowStartISO(dateIsos, backfillFrom).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

/** How many candidates a pass may confirm before it refuses as implausible. */
export function candidateCap(base: number): number {
  return Math.max(CAP_MIN, Math.floor(CAP_FRACTION * base));
}

/**
 * Links whose activity the listing did not return. A link made AT OR AFTER the
 * listing started is never a candidate (the import or a Sync may have linked an
 * activity the listing had already paged past); the delete RPC re-applies the
 * same cut-off server-side (p_linked_before). `base` is the cap's denominator:
 * the links inside the listed window.
 */
export function selectCandidates(
  links: LinkRow[],
  listedIds: Set<number>,
  listingStartedAtMs: number,
  windowStartISO: string,
): { candidates: LinkRow[]; base: number } {
  const base = links.filter((l) => l.date_iso == null || l.date_iso >= windowStartISO).length;
  const candidates = links.filter((l) => {
    const created = Date.parse(l.link_created_at);
    return Number.isFinite(created) && created < listingStartedAtMs && !listedIds.has(l.strava_activity_id);
  });
  return { candidates, base };
}

/** True when the pass should run now. NULL or unparseable due times count as due. */
export function isReconcileDue(sync: { reconcile_due_at?: string | null }, nowMs: number): boolean {
  if (sync.reconcile_due_at == null) return true;
  const due = Date.parse(sync.reconcile_due_at);
  if (!Number.isFinite(due)) return true;
  return due <= nowMs + RECONCILE_DUE_SLACK_MS;
}

const toLink = (raw: Record<string, unknown>): LinkRow => ({
  session_id: Number(raw.session_id),
  strava_activity_id: Number(raw.strava_activity_id),
  date_iso: typeof raw.date_iso === "string" ? raw.date_iso : null,
  link_created_at: String(raw.link_created_at ?? ""),
});

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export async function runReconcile(deps: ReconcileDeps, opts: ReconcileOptions): Promise<ReconcileResult> {
  const { supa, accessToken } = deps;
  const now = deps.now ?? (() => Date.now());
  const budget = deps.budget ?? RECONCILE_BUDGET;
  const timeoutMs = deps.timeoutMs ?? STRAVA_TIMEOUT_MS;
  const { userId, mode, dryRun, sync } = opts;
  const startedAt = now();

  const result: ReconcileResult = {
    ok: true,
    status: "noop",
    reason: null,
    links: 0,
    listed: 0,
    candidates: 0,
    cap: 0,
    confirmedGone: 0,
    deleted: 0,
    keptUnlinked: 0,
    restored: 0,
    stravaCalls: 0,
  };
  const decisions: ReconcileDecision[] = [];

  let calls = 0;
  let rateLimit: RateLimit = deps.rateLimit ?? EMPTY_RATE_LIMIT;
  const outOfBudget = () =>
    shouldStopChunk(calls, now() - startedAt, rateLimit, budget, RECONCILE_STOP_FRACTION).stop;

  const report = (e: unknown, stage: string) =>
    captureFunctionError(FN, e, { userId, mode, stage, links: result.links, candidates: result.candidates });

  // Every exit goes through here: it fixes the status, and on a real run writes
  // the next due time (Q-C) — or, when Strava refused the token, the revocation
  // patch. A dry run writes nothing at all.
  const finish = async (
    status: ReconcileStatus,
    reason: string | null,
    opt: { write?: boolean; extra?: Record<string, unknown> } = {},
  ): Promise<ReconcileResult> => {
    result.status = status;
    result.reason = reason;
    result.stravaCalls = calls;
    result.ok = status === "ok" || status === "noop" || status === "not_due" || status === "skipped_rate_limited";
    if (dryRun) result.decisions = decisions;

    if (!dryRun && opt.write !== false) {
      let patch: Record<string, unknown> | null = null;
      if (status === "auth_failed") patch = revokedPatch(sync, mode, now());
      else if (status === "ok" || status === "noop") {
        patch = { reconcile_due_at: new Date(now() + RECONCILE_INTERVAL_MS).toISOString() };
      } else if (ABORTS.has(status)) {
        patch = { reconcile_due_at: new Date(now() + RECONCILE_RETRY_MS).toISOString(), ...opt.extra };
      }
      if (patch) {
        const { error } = await supa
          .from("strava_sync_state")
          .update({ ...patch, updated_at: new Date(now()).toISOString() })
          .eq("user_id", userId);
        if (error) await report(new Error(`reconcile sync write failed: ${error.code ?? "unknown"}`), "reconcile_write");
      }
    }
    return result;
  };

  const holdUntil = (rl: RateLimit): string =>
    new Date(isDailyCapExhausted(rl) ? nextUtcMidnight(now()) : nextQuarterHour(now())).toISOString();

  // 1-3. Gates that spend nothing.
  if (!sync.connected) return finish("noop", "not_connected", { write: false });
  // D7: a dry run is an explicit request to see the plan, so it ignores the due time.
  if (!dryRun && !isReconcileDue(sync, now())) return finish("not_due", null, { write: false });
  if (sync.rate_limit_resets_at && Date.parse(sync.rate_limit_resets_at) > now()) {
    return finish("skipped_rate_limited", null, { write: false });
  }

  // 4. The links.
  const { data: inv, error: invErr } = await supa.rpc("strava_link_inventory", { p_user_id: userId });
  if (invErr) {
    await report(new Error(`strava_link_inventory failed: ${invErr.code ?? "unknown"}`), "reconcile_inventory");
    return finish("error", "inventory_failed");
  }
  const links = (Array.isArray(inv) ? inv : []).map((r) => toLink(r as Record<string, unknown>));
  result.links = links.length;
  if (links.length === 0) return finish("noop", "no_links");

  // 6-7. List the whole window. `after` is held fixed and only `page` moves
  // (the same double-advance trap the incremental pass documents).
  const listingStartedAt = now();
  const backfillFrom = sync.backfill_from ?? deps.backfillFrom;
  const windowStart = reconcileWindowStartISO(links.map((l) => l.date_iso), backfillFrom);
  const after = reconcileWindowAfter(links.map((l) => l.date_iso), backfillFrom);
  const listed = new Set<number>();
  let listedTotal = 0;

  for (let page = 1;; page++) {
    if (outOfBudget()) return finish("truncated", "budget");
    calls++;
    let listing: Awaited<ReturnType<typeof listActivities>>;
    try {
      listing = await listActivities(accessToken, { after, page, perPage: PER_PAGE, timeoutMs });
    } catch (e) {
      if (e instanceof StravaRateLimitError) {
        rateLimit = e.rateLimit;
        return finish("listing_failed", "rate_limited", { extra: { rate_limit_resets_at: holdUntil(e.rateLimit) } });
      }
      if (e instanceof StravaAuthError) return finish("auth_failed", "listing_unauthorized");
      await report(e, "reconcile_list");
      return finish("listing_failed", e instanceof StravaHttpError ? `http_${e.status}` : "request_failed");
    }
    rateLimit = listing.rateLimit;
    if (!listing.wellFormed) {
      await report(new Error("strava listing was not an array"), "reconcile_list");
      return finish("listing_malformed", null);
    }
    for (const a of listing.activities) {
      listedTotal++;
      const id = (a as { id?: unknown }).id;
      if (typeof id === "number") listed.add(id);
    }
    result.listed = listedTotal;
    // Exhausted ONLY on a well-formed 200 page shorter than a full one.
    if (listing.activities.length < PER_PAGE) break;
  }

  if (listedTotal === 0) {
    // The athlete has linked sessions, so a listing with nothing in it is far
    // likelier a Strava fault than every activity deleted at once.
    await report(new Error("strava listing empty with links present"), "reconcile_list");
    return finish("listing_empty", null);
  }

  // 8. Candidates, and the cap.
  const { candidates, base } = selectCandidates(links, listed, listingStartedAt, windowStart);
  result.candidates = candidates.length;
  result.cap = candidateCap(base);
  if (candidates.length === 0) return finish("ok", null);
  if (candidates.length > result.cap) {
    await report(new Error("reconcile candidates over the cap"), "reconcile_cap");
    return finish("capped", null);
  }

  // 9. Confirm each candidate. Only a 404 is "gone".
  const gone: number[] = [];
  for (const c of candidates) {
    if (outOfBudget()) return finish("truncated", "budget");
    calls++;
    try {
      const { activity, rateLimit: rl } = await getActivity(accessToken, c.strava_activity_id, { timeoutMs });
      rateLimit = rl;
      if (!activity) {
        await report(new Error("strava activity detail was empty"), "reconcile_detail");
        return finish("detail_failed", "empty_body");
      }
      decisions.push({ activityId: c.strava_activity_id, action: "keep_present" });
    } catch (e) {
      if (e instanceof StravaHttpError && e.status === 404) {
        gone.push(c.strava_activity_id);
        continue;
      }
      if (e instanceof StravaAuthError) return finish("auth_failed", "detail_unauthorized");
      if (e instanceof StravaRateLimitError) {
        rateLimit = e.rateLimit;
        return finish("detail_failed", "rate_limited", { extra: { rate_limit_resets_at: holdUntil(e.rateLimit) } });
      }
      await report(e, "reconcile_detail");
      const reason = e instanceof StravaHttpError
        ? `http_${e.status}`
        : (e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError"
        ? "timeout"
        : "request_failed";
      return finish("detail_failed", reason);
    }
  }

  result.confirmedGone = gone.length;
  if (gone.length === 0) return finish("ok", null);

  // 10. The delete. p_linked_before repeats the cut-off server-side, so a link
  // made after the listing started can never be deleted by this pass.
  const { data: out, error: purgeErr } = await supa.rpc("purge_strava_activities", {
    p_user_id: userId,
    p_activity_ids: gone,
    p_linked_before: new Date(listingStartedAt).toISOString(),
    p_dry_run: dryRun,
  });
  if (purgeErr) {
    await report(new Error(`purge_strava_activities failed: ${purgeErr.code ?? "unknown"}`), "reconcile_purge");
    return finish("error", "purge_failed");
  }
  const o = (out ?? {}) as Record<string, unknown>;
  result.deleted = num(o.deleted);
  result.keptUnlinked = num(o.kept);
  result.restored = num(o.restored);
  if (dryRun && Array.isArray(o.actions)) {
    for (const a of o.actions as Record<string, unknown>[]) {
      const action = a.action;
      if (action === "delete" || action === "keep_unlink" || action === "restore_unlink") {
        decisions.push({ activityId: Number(a.activity_id), action });
      }
    }
  }
  return finish("ok", null);
}
