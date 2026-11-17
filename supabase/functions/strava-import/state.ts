// state.ts — cursor and budget arithmetic, pure. No IO, no clock of its own:
// every function that needs "now" takes it as an argument, which is what makes
// the throttling behaviour testable instead of timing-dependent.
import type { RateLimit } from "./client.ts";

/**
 * Detail fetches per invocation. The real constraint is Strava's 15-minute read
 * quota shared with every other call the app makes; this is the belt to that
 * braces, so one runaway backfill cannot spend the whole window.
 */
export const MAX_STRAVA_CALLS = 50;

/**
 * Wall-clock budget. Supabase edge functions have a hard execution ceiling, and
 * a run killed mid-page loses whatever it had not yet persisted. Stopping
 * ourselves at 20 s means the cursor is always written by a run that chose to
 * stop, never by one that was cut off.
 */
export const MAX_WALL_MS = 20_000;

/**
 * Stop at 80% of a Strava window rather than 100%, for both the 15-minute and
 * the daily window. The remaining 20% is headroom for a manual Sync and any
 * other caller sharing the app's quota in the same window — spending the quota
 * to the last call would make THOSE fail instead, which is a much worse trade
 * than one slower backfill. The app's read limits are 100 per 15 minutes and
 * 1,000 per day, but the figures used are always the ones in the response
 * headers, never these.
 */
export const RATE_LIMIT_STOP_FRACTION = 0.8;

export const QUARTER_HOUR_MS = 15 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type StopReason = "calls" | "elapsed" | "rate_limit" | "daily_rate_limit" | null;
export type ChunkBudget = { maxCalls: number; maxElapsedMs: number };

export const DEFAULT_BUDGET: ChunkBudget = {
  maxCalls: MAX_STRAVA_CALLS,
  maxElapsedMs: MAX_WALL_MS,
};

/**
 * The deletion-sync pass (#630, reconcile.ts) stops at HALF of either Strava
 * window, not 80%. It is housekeeping: it must never be the reason the import
 * or a manual Sync finds the quota spent, and a reconcile that stops early just
 * retries an hour later (Strava's deletion deadline is 48 hours).
 */
export const RECONCILE_STOP_FRACTION = 0.5;

/**
 * Reconcile's own ceiling. It runs inside runImport after the import's writes,
 * and is ALSO held to whatever is left of the run's budget — whichever is
 * tighter wins (see runImport).
 */
export const RECONCILE_BUDGET: ChunkBudget = { maxCalls: 20, maxElapsedMs: 20_000 };

/** Days between Strava reporting a grant dead and the purge (owner decision on #628). */
export const PURGE_GRACE_DAYS = 21;

/**
 * The strava_sync_state patch for "Strava says this grant is dead": the
 * connection is marked down and the purge is scheduled PURGE_GRACE_DAYS out.
 *
 * purge_due_at is set ONCE and never pushed later (D11): a second auth failure
 * inside the grace period keeps the first deadline, or a grant that kept
 * failing would never be purged. The token row is NOT touched here (D10): only
 * purge_strava_user (migration 019) deletes it. Pure, so it lives here rather
 * than in importer.ts, where reconcile.ts could not import it without a cycle;
 * importer.ts re-exports it.
 */
export function revokedPatch(
  sync: { purge_due_at?: string | null },
  mode: "cron" | "user",
  nowMs: number,
): Record<string, unknown> {
  const nowISO = new Date(nowMs).toISOString();
  return {
    connected: false,
    disconnected_at: nowISO,
    last_run_at: nowISO,
    last_run_mode: mode,
    last_run_status: "auth_failed",
    last_error_code: "auth_failed",
    purge_due_at: sync.purge_due_at ?? new Date(nowMs + PURGE_GRACE_DAYS * DAY_MS).toISOString(),
  };
}

/**
 * Should this invocation stop fetching and persist what it has?
 *
 * The four limits are independent and any one of them trips: a run can be
 * inside its call budget and inside its time budget and still have to stop
 * because a shared Strava quota is nearly spent.
 *
 * When several are true at once the daily cap is reported, ahead of calls and
 * elapsed too: it is the only reason that changes when the next run may start
 * (the hold until midnight UTC), so reporting a weaker one would drop that hold
 * and let the cron spend a read every 15 minutes until the reset.
 */
export function shouldStopChunk(
  calls: number,
  elapsedMs: number,
  rateLimit: RateLimit,
  budget: ChunkBudget = DEFAULT_BUDGET,
  stopFraction: number = RATE_LIMIT_STOP_FRACTION,
): { stop: boolean; reason: StopReason } {
  if (isNearDailyCap(rateLimit, stopFraction)) return { stop: true, reason: "daily_rate_limit" };
  if (calls >= budget.maxCalls) return { stop: true, reason: "calls" };
  if (elapsedMs >= budget.maxElapsedMs) return { stop: true, reason: "elapsed" };
  if (
    rateLimit.shortLimit != null &&
    rateLimit.shortUsage != null &&
    rateLimit.shortLimit > 0 &&
    rateLimit.shortUsage >= stopFraction * rateLimit.shortLimit
  ) {
    return { stop: true, reason: "rate_limit" };
  }
  return { stop: false, reason: null };
}

/**
 * The stop reason a run records when a new one arrives. Once the daily cap has
 * stopped the run it stays the reason for the rest of it: a later `calls`,
 * `elapsed` or quarter-hour stop must not overwrite it and lose the midnight
 * hold. Otherwise the latest reason wins, as it always has.
 */
export function mergeStopReason(current: StopReason, next: StopReason): StopReason {
  if (current === "daily_rate_limit") return current;
  return next ?? current;
}

/**
 * Daily usage at or past `fraction` (80% by default) of the daily limit. False
 * when Strava sent no daily figures.
 */
export function isNearDailyCap(rateLimit: RateLimit, fraction: number = RATE_LIMIT_STOP_FRACTION): boolean {
  return (
    rateLimit.dailyLimit != null &&
    rateLimit.dailyUsage != null &&
    rateLimit.dailyLimit > 0 &&
    rateLimit.dailyUsage >= fraction * rateLimit.dailyLimit
  );
}

/**
 * Daily usage at or past the daily limit itself: a 429 carrying this is the
 * daily cap, not the 15-minute one, and retrying on the quarter hour would
 * only collect another 429 every 15 minutes until midnight UTC.
 */
export function isDailyCapExhausted(rateLimit: RateLimit): boolean {
  return (
    rateLimit.dailyLimit != null &&
    rateLimit.dailyUsage != null &&
    rateLimit.dailyLimit > 0 &&
    rateLimit.dailyUsage >= rateLimit.dailyLimit
  );
}

/**
 * Next 00:00 UTC, strictly after `nowMs`. Strava: "The daily limit resets at
 * midnight UTC" (developers.strava.com/docs/rate-limits, read 2026-11-16).
 * Exactly on midnight returns the FOLLOWING midnight, for the same reason as
 * nextQuarterHour.
 */
export function nextUtcMidnight(nowMs: number): number {
  return (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
}

/**
 * Next 00/15/30/45 boundary, strictly after `nowMs`. Strava's short window
 * resets on the quarter hour, so this is when a rate-limited run may resume.
 * Exactly on a boundary returns the NEXT one — resuming at the instant of a
 * reset races the reset itself.
 */
export function nextQuarterHour(nowMs: number): number {
  return (Math.floor(nowMs / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS;
}

/**
 * Move the backfill `before` cursor further back in time.
 *
 * Strava returns a page newest-first, so the oldest activity on the page is the
 * next boundary. The cursor MUST decrease on every page or the backfill re-lists
 * the same page forever, spending the quota and never finishing. When a page
 * cannot supply a strictly smaller value — every activity shares the boundary
 * second, or the page was empty of usable timestamps — we step back one second
 * by hand. One second of history is a cheap price for a guaranteed terminator.
 */
export function advanceBackfillCursor(
  current: number | null,
  epochSeconds: number[],
): number | null {
  const usable = epochSeconds.filter((n) => Number.isFinite(n));
  if (usable.length === 0) return current == null ? null : current - 1;
  const oldest = Math.min(...usable);
  if (current == null) return oldest;
  return oldest < current ? oldest : current - 1;
}

/**
 * Incremental watermark. Advances over EVERYTHING seen, ineligible activities
 * included — a week containing nothing but WeightTraining must still move the
 * watermark, or every subsequent run re-lists that week for ever.
 */
export function advanceIncrementalWatermark(
  current: number | null,
  epochSeconds: number[],
): number | null {
  const usable = epochSeconds.filter((n) => Number.isFinite(n));
  if (usable.length === 0) return current;
  const newest = Math.max(...usable);
  if (current == null) return newest;
  return newest > current ? newest : current;
}

/** Unix seconds from a UTC ISO stamp. Strava's `start_date` always ends in Z. */
export function epochSecondsFromUTC(startDate: string | null | undefined): number {
  const ms = Date.parse(String(startDate ?? ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}
