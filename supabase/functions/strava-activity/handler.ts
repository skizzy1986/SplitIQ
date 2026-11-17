// handler.ts — the request flow of strava-activity (#647): one session's Strava
// detail and streams, served from a cache that holds them for at most six days
// (migration 020, strava_activity_cache).
//
// Type-only supabase-js import, for the reason strava-import/importer.ts gives:
// test.ts drives this with a structural fake and must not need jsr.io in its
// module graph. index.ts is the one value import.
//
// Every typed outcome is HTTP 200 with a `status`: functions.invoke turns any
// non-2xx into an error whose body is awkward to read (Context7
// /supabase/supabase-js). The flow returns at the first step that decides.
//
// Writes. The cache table; on a 429, a rate-limit hold on strava_sync_state that
// can only be extended; and, through tokens.ts, a refresh-token rotation when
// the access token is stale (the compare-and-swap every caller must persist —
// Strava rotates the refresh token on every refresh). It never DELETES the
// token row (the store's remove is a no-op, as strava-connect/disconnect.ts
// does it) and never records revocation state on strava_sync_state: the
// importer is the only writer of that. When it learns the grant is refused or
// gone, it drops this user's cache rows and nothing else.
//
// Sentry. Only ids and a stage reach it, never an activity id, a token or a
// response body: an upstream failure is reported as a fresh Error carrying the
// stage, the original error's name and, for an HTTP error, its status.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  getActivity,
  getActivityStreams,
  StravaAuthError,
  StravaHttpError,
  StravaRateLimitError,
} from "../strava-import/client.ts";
import { createSupabaseTokenStore } from "../strava-import/importer.ts";
import { isGarminRecorded, type StravaActivity } from "../strava-import/mapper.ts";
import { isDailyCapExhausted, nextQuarterHour, nextUtcMidnight } from "../strava-import/state.ts";
import { getFreshAccessToken, type RefreshFn, type TokenStore } from "../strava-import/tokens.ts";
import { captureFunctionError } from "../_shared/sentry.ts";
import {
  CACHE_PAYLOAD_VERSION,
  CACHE_TTL_MS,
  type CachedActivity,
  type CachedPayload,
  type CachedStreams,
  normaliseActivity,
  stravaActivityUrl,
} from "./normalise.ts";

export const FN = "strava-activity";

/** Per Strava call. The page waits on this request, so it is bounded. */
export const STRAVA_TIMEOUT_MS = 8000;

export type CaptureFn = (fn: string, error: unknown, context: Record<string, unknown>) => Promise<void>;

export type ActivityDeps = {
  supa: SupabaseClient;
  refresh: RefreshFn;
  /** Default: the Supabase token store, with remove() replaced by a no-op. */
  store?: TokenStore;
  now?: () => number;
  /** Default: captureFunctionError. A test seam for what reaches Sentry. */
  capture?: CaptureFn;
};

export type ActivityResponse =
  | {
    status: "ok";
    cached: boolean;
    origin: "inserted" | "adopted";
    strava_activity_id: number;
    /** The activity's page on Strava (stravaActivityUrl); on `ok` only, never cached. */
    url: string;
    fetched_at: string;
    expires_at: string;
    activity: CachedActivity;
    streams: CachedStreams;
  }
  | { status: "rate_limited"; retry_at: string }
  | {
    status:
      | "not_linked"
      | "not_connected"
      | "auth_failed"
      | "gone"
      | "garmin_attribution_pending"
      | "upstream_error";
  };

type Link = { session_id: number; strava_activity_id: number; origin: "inserted" | "adopted"; device_name: string | null };
type CacheRow = { strava_activity_id: number; payload: unknown; fetched_at: string; expires_at: string };

const CACHE = "strava_activity_cache";

const iso = (ms: number) => new Date(ms).toISOString();
const ok200 = (body: ActivityResponse) => ({ httpStatus: 200, body });
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** A cached payload this code wrote, in the shape it writes now; anything else is a miss. */
function usablePayload(p: unknown): p is CachedPayload {
  return isPlainObject(p) && p.v === CACHE_PAYLOAD_VERSION && isPlainObject(p.activity) && isPlainObject(p.streams);
}

/**
 * A fresh Error for Sentry, never the upstream one: a malformed 200 makes
 * res.json() throw a SyntaxError whose message quotes the body.
 */
function upstreamError(stage: string, e: unknown): Error {
  const name = e instanceof Error ? e.name : typeof e;
  const status = e instanceof StravaHttpError ? ` HTTP ${e.status}` : "";
  return new Error(`strava ${stage} failed: ${name}${status}`);
}

export async function handleActivityRequest(
  deps: ActivityDeps,
  userId: string,
  sessionId: number,
): Promise<{ httpStatus: number; body: ActivityResponse }> {
  const { supa, refresh } = deps;
  const now = deps.now ?? (() => Date.now());
  const captureFn = deps.capture ?? captureFunctionError;
  const capture = (err: unknown, stage: string) => captureFn(FN, err, { userId, sessionId, stage });

  // A cache delete that fails is reported and does not change the answer: the
  // row expires and the hourly sweep removes it regardless.
  const deleteCache = async (scope: "session" | "user") => {
    let q = supa.from(CACHE).delete().eq("user_id", userId);
    if (scope === "session") q = q.eq("session_id", sessionId);
    const { error } = await q;
    if (error) await capture(new Error(`strava_activity_cache delete failed: ${error.code ?? "unknown"}`), "cache_delete");
  };

  // The grant is refused or gone: nothing of this user's may stay cached.
  // Nothing is written to strava_tokens or strava_sync_state.
  const refused = async (status: "auth_failed" | "not_connected") => {
    await deleteCache("user");
    return ok200({ status });
  };

  // Only ever extends a hold: two conditional updates, each atomic, together
  // `where rate_limit_resets_at is null or rate_limit_resets_at < X`. Then the
  // hold actually in force is read back, so retry_at is never earlier than a
  // later hold another worker set.
  const holdUntil = async (resetsAtMs: number) => {
    const x = iso(resetsAtMs);
    const patch = { rate_limit_resets_at: x, updated_at: iso(now()) };
    const a = await supa.from("strava_sync_state").update(patch).eq("user_id", userId).is("rate_limit_resets_at", null);
    const b = await supa.from("strava_sync_state").update(patch).eq("user_id", userId).lt("rate_limit_resets_at", x);
    const error = a.error ?? b.error;
    if (error) await capture(new Error(`strava_sync_state hold write failed: ${error.code ?? "unknown"}`), "rate_limit_hold");

    const back = await supa.from("strava_sync_state").select("rate_limit_resets_at").eq("user_id", userId).maybeSingle();
    if (back.error) {
      await capture(new Error(`strava_sync_state hold read failed: ${back.error.code ?? "unknown"}`), "rate_limit_hold");
      return x;
    }
    const stored = Date.parse(String((back.data as { rate_limit_resets_at?: unknown } | null)?.rate_limit_resets_at ?? ""));
    return Number.isFinite(stored) && stored > resetsAtMs ? iso(stored) : x;
  };

  const rateLimited = async (e: StravaRateLimitError) => {
    const t = now();
    const resetsAt = isDailyCapExhausted(e.rateLimit) ? nextUtcMidnight(t) : nextQuarterHour(t);
    return ok200({ status: "rate_limited", retry_at: await holdUntil(resetsAt) });
  };

  // 1. The link, for this session AND this user. Unlinked, someone else's and
  //    absent all give the same answer.
  const linkRes = await supa
    .from("strava_session_links")
    .select("session_id, strava_activity_id, origin, device_name")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (linkRes.error) throw new Error(`strava_session_links read failed: ${linkRes.error.code ?? "unknown"}`);
  const link = linkRes.data as Link | null;
  if (!link) return ok200({ status: "not_linked" });
  const activityId = Number(link.strava_activity_id);

  // 2. The connection.
  const syncRes = await supa
    .from("strava_sync_state")
    .select("connected, rate_limit_resets_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (syncRes.error) throw new Error(`strava_sync_state read failed: ${syncRes.error.code ?? "unknown"}`);
  const sync = syncRes.data as { connected: boolean; rate_limit_resets_at: string | null } | null;
  if (!sync || sync.connected !== true) return await refused("not_connected");

  // 3. Garmin-recorded: nothing shown until attribution ships (#632).
  if (isGarminRecorded({ device_name: link.device_name } as StravaActivity)) {
    await deleteCache("session");
    return ok200({ status: "garmin_attribution_pending" });
  }

  // 4. A fresh cache row for the same activity, in the current payload shape.
  const cacheRes = await supa
    .from(CACHE)
    .select("strava_activity_id, payload, fetched_at, expires_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (cacheRes.error) {
    await capture(new Error(`strava_activity_cache read failed: ${cacheRes.error.code ?? "unknown"}`), "cache_read");
  }
  const cached = (cacheRes.error ? null : cacheRes.data) as CacheRow | null;
  if (
    cached && Date.parse(cached.expires_at) > now() && Number(cached.strava_activity_id) === activityId &&
    usablePayload(cached.payload)
  ) {
    return ok200({
      status: "ok",
      cached: true,
      origin: link.origin,
      strava_activity_id: activityId,
      url: stravaActivityUrl(activityId),
      fetched_at: iso(Date.parse(cached.fetched_at)),
      expires_at: iso(Date.parse(cached.expires_at)),
      activity: cached.payload.activity,
      streams: cached.payload.streams,
    });
  }

  // 5. A hold already in force: no Strava call.
  const holdMs = sync.rate_limit_resets_at ? Date.parse(sync.rate_limit_resets_at) : NaN;
  if (Number.isFinite(holdMs) && holdMs > now()) {
    return ok200({ status: "rate_limited", retry_at: iso(holdMs) });
  }

  // 6. A live token. This path may rotate the token row; it never deletes it.
  const base = deps.store ?? createSupabaseTokenStore(supa);
  const keepRow: TokenStore = { read: base.read, rotate: base.rotate, remove: () => Promise.resolve() };
  const token = await getFreshAccessToken(keepRow, refresh, userId, now());
  if (token.status === "not_connected") return await refused("not_connected");
  if (token.status === "auth_failed") return await refused("auth_failed");
  if (token.status === "refresh_failed") {
    await capture(new Error("strava token refresh failed"), "token");
    return ok200({ status: "upstream_error" });
  }

  // 7. The detail. The activity id comes from the link row, never the request.
  let detail: unknown;
  try {
    detail = (await getActivity(token.accessToken, activityId, { timeoutMs: STRAVA_TIMEOUT_MS })).activity;
  } catch (e) {
    if (e instanceof StravaHttpError && e.status === 404) {
      await deleteCache("session");
      return ok200({ status: "gone" });
    }
    if (e instanceof StravaRateLimitError) return await rateLimited(e);
    // Revocation state is the importer's to record; the cache is ours to drop.
    if (e instanceof StravaAuthError) return await refused("auth_failed");
    await capture(upstreamError("detail", e), "detail");
    return ok200({ status: "upstream_error" });
  }
  if (!isPlainObject(detail)) {
    await capture(new Error("strava detail failed: body was not an object"), "detail");
    return ok200({ status: "upstream_error" });
  }
  if (isGarminRecorded(detail as unknown as StravaActivity)) {
    await deleteCache("session");
    return ok200({ status: "garmin_attribution_pending" });
  }

  // 8. The streams. A 404 here means the activity has none.
  let streams: unknown = null;
  try {
    streams = (await getActivityStreams(token.accessToken, activityId, { timeoutMs: STRAVA_TIMEOUT_MS })).streams;
  } catch (e) {
    if (e instanceof StravaHttpError && e.status === 404) {
      streams = null;
    } else if (e instanceof StravaRateLimitError) {
      return await rateLimited(e);
    } else if (e instanceof StravaAuthError) {
      return await refused("auth_failed");
    } else {
      await capture(upstreamError("streams", e), "streams");
      return ok200({ status: "upstream_error" });
    }
  }

  // 9. Normalise and cache.
  const payload = normaliseActivity(detail, streams);
  const fetchedAt = now();
  const row = {
    session_id: sessionId,
    user_id: userId,
    strava_activity_id: activityId,
    payload,
    fetched_at: iso(fetchedAt),
    expires_at: iso(fetchedAt + CACHE_TTL_MS),
  };
  const up = await supa.from(CACHE).upsert(row, { onConflict: "session_id" });
  if (up.error) {
    // The link was purged while Strava answered: the data must not be served.
    if (up.error.code === "23503") return ok200({ status: "not_linked" });
    // Any other failure still serves the page; the next open fetches again.
    await capture(new Error(`strava_activity_cache upsert failed: ${up.error.code ?? "unknown"}`), "cache_write");
  }

  // 10. `cached` means "served from the cache", which a fresh fetch never is.
  //     `v` stays in the cache: the response carries the frozen contract only.
  return ok200({
    status: "ok",
    cached: false,
    origin: link.origin,
    strava_activity_id: activityId,
    url: stravaActivityUrl(activityId),
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
    activity: payload.activity,
    streams: payload.streams,
  });
}
