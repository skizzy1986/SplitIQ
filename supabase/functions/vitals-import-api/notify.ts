// One Slack line after the nightly vitals-import-api run. The webhook URL is the
// Supabase secret SLACK_WEBHOOK_VITALS. Counts and status only: a heart-rate,
// sleep or weight value must never be interpolated into the text.

export const VITALS_SLACK_SECRET = "SLACK_WEBHOOK_VITALS";

export const METRIC_TOTAL = 4;

const FAILURES = {
  "missing env": "vitals-import-api FAIL · missing env",
  "token exchange failed":
    "vitals-import-api FAIL · token exchange failed · the refresh token is dead; re-run scripts/google-health-oauth.ts",
  "upsert failed": "vitals-import-api FAIL · upsert failed",
} as const;

export type VitalsFailure = keyof typeof FAILURES;

export function importedMetricCount(rec: {
  hrv_ms: number | null;
  rhr_bpm: number | null;
  sleep_hours: number | null;
  bodyweight_kg: number | null;
}): number {
  return [rec.hrv_ms, rec.rhr_bpm, rec.sleep_hours, rec.bodyweight_kg].filter((v) => v != null).length;
}

export function successLine(imported: number): string {
  return `vitals-import-api OK · 1 date, ${imported} of ${METRIC_TOTAL} metrics`;
}

export function failureLine(errorClass: VitalsFailure): string {
  return FAILURES[errorClass];
}

// Best-effort. An unset secret returns without calling fetch. A network error,
// a timeout or a non-2xx response is swallowed: a Slack failure never fails the import.
export async function postVitalsSlack(
  webhookUrl: string | undefined,
  text: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    await res.body?.cancel();
  } catch {
    // A Slack outage never fails the import.
  }
}
