// sync.ts — the pure half of vitals-sync: CORS, the date window, the Google
// Health query specs, the skip rule, and the shapes it writes and returns.
// No IO and no jsr imports, so test.ts runs without network or a Supabase client.
import type { VitalRecord } from "../vitals-import-api/mapper.ts";

// Same list as strava-connect and strava-sync, and for the same reason:
// supabase.functions.invoke goes through the Sentry-instrumented global fetch,
// so this function is preflighted with `sentry-trace` and `baggage` too.
// Dropping either fails the OPTIONS and the request is never sent (#301).
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export const REQUIRED_ENV = [
  "GOOGLE_HEALTH_CLIENT_ID",
  "GOOGLE_HEALTH_CLIENT_SECRET",
  "GOOGLE_HEALTH_REFRESH_TOKEN",
  "VITALS_USER_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function missingEnv(get: (k: string) => string | undefined): string[] {
  return REQUIRED_ENV.filter((k) => !get(k));
}

// The refusal for a caller who is not VITALS_USER_ID, or null to let them through.
// An unset owner passes so missingEnv reports the misconfiguration as a 500.
export function ownerGate(
  sub: string | null,
  ownerId: string | undefined,
): { status: 401 | 403; body: { error: "unauthorized" | "not_owner" } } | null {
  if (!sub) return { status: 401, body: { error: "unauthorized" } };
  // An unset owner passes so missingEnv returns its 500. A blank (whitespace-only)
  // one refuses everyone, because missingEnv sees it as set and would not catch it.
  if (!ownerId) return null;
  // UUIDs are case-insensitive and a pasted secret can carry whitespace or a
  // newline; neither should lock the owner out.
  const owner = ownerId.trim().toLowerCase();
  if (!owner || sub.toLowerCase() !== owner) return { status: 403, body: { error: "not_owner" } };
  return null;
}

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Yesterday in Perth time (UTC+8, no DST) — same window as the scheduled cron.
// Returns the day and the exclusive upper bound used by every filter.
export function perthYesterday(nowMs: number): { date: string; nextDate: string } {
  const d = new Date(nowMs + 8 * 3600 * 1000 - 24 * 3600 * 1000);
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86400000,
  );
  return { date: ymd(d), nextDate: ymd(next) };
}

export type Spec = { key: string; dt: string; filter: string; pageSize?: number };

export function buildSpecs(date: string, nextDate: string): Spec[] {
  const range = (field: string) => `${field} >= "${date}" AND ${field} < "${nextDate}"`;
  return [
    { key: "hrv", dt: "daily-heart-rate-variability", filter: range("daily_heart_rate_variability.date") },
    { key: "rhr", dt: "daily-resting-heart-rate", filter: range("daily_resting_heart_rate.date") },
    { key: "sleep", dt: "sleep", filter: range("sleep.interval.civil_end_time"), pageSize: 25 },
    { key: "weight", dt: "weight", filter: range("weight.sample_time.civil_time") },
    { key: "steps", dt: "daily-steps", filter: range("daily_steps.date") },
    { key: "distance", dt: "daily-distance", filter: range("daily_distance.date") },
    { key: "activeMin", dt: "daily-active-minutes", filter: range("daily_active_minutes.date") },
    { key: "calories", dt: "daily-calories-expended", filter: range("daily_calories_expended.date") },
  ];
}

type CoreRow = {
  rhr_bpm?: number | null;
  hrv_ms?: number | null;
  sleep_hours?: number | null;
  bodyweight_kg?: number | null;
} | null | undefined;

// Skip the Google API calls entirely when all four core fields are already in.
export function coreComplete(row: CoreRow): boolean {
  return row?.rhr_bpm != null && row?.hrv_ms != null && row?.sleep_hours != null &&
    row?.bodyweight_kg != null;
}

// Arguments for the live-only 11-arg upsert_vital overload (#454).
export function upsertParams(userId: string, date: string, rec: VitalRecord) {
  return {
    p_user_id: userId,
    p_date: date,
    p_rhr: rec.rhr_bpm,
    p_hrv: rec.hrv_ms,
    p_sleep: rec.sleep_hours,
    p_bodyweight: rec.bodyweight_kg,
    p_source: "google_health_api",
    p_steps: rec.steps_count,
    p_distance: rec.distance_m,
    p_active_min: rec.active_minutes,
    p_calories: rec.calories_kcal,
  };
}

export function nullFields(rec: VitalRecord): string[] {
  return ([
    ["hrv", rec.hrv_ms],
    ["rhr", rec.rhr_bpm],
    ["sleep", rec.sleep_hours],
    ["bodyweight", rec.bodyweight_kg],
    ["steps_count", rec.steps_count],
    ["distance_m", rec.distance_m],
    ["active_minutes", rec.active_minutes],
    ["calories_kcal", rec.calories_kcal],
  ] as [string, unknown][]).filter(([, v]) => v == null).map(([k]) => k);
}

// 200 when every field came back, 207 when some are null (partial content).
export function resultStatus(nulls: string[]): number {
  return nulls.length ? 207 : 200;
}
