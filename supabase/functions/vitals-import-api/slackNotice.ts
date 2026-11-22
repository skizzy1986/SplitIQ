// slackNotice.ts — the one line the nightly vitals-api-import posts to Slack.
// Counts and status only. Health values never reach this file's output, and a
// Slack failure never reaches the caller: postVitalsSlack swallows it.

export const VITALS_METRIC_COUNT = 4;

const TOKEN_HINT =
  "the refresh token is dead; re-run scripts/google-health-oauth.ts";

// Fixed strings. A caller cannot interpolate a Google body or a measurement
// into the line by passing a novel error class.
const FAILURES: Record<string, string> = {
  "token exchange failed": `vitals-api-import FAIL · token exchange failed · ${TOKEN_HINT}`,
  "missing env": "vitals-api-import FAIL · missing env",
  "upsert failed": "vitals-api-import FAIL · upsert failed",
};

export type VitalsSlackOutcome =
  | { ok: true; imported: number; attempted: number }
  | { ok: false; errorClass: string };

function count(n: number): number {
  if (!Number.isInteger(n) || n < 0) return 0;
  return n > 99 ? 99 : n;
}

// How many of the four imported fields actually arrived. The values themselves
// stay here and are not part of the returned number's formatting.
export function importedMetricCount(rec: {
  hrv_ms: number | null;
  rhr_bpm: number | null;
  sleep_hours: number | null;
  bodyweight_kg: number | null;
}): number {
  return [rec.hrv_ms, rec.rhr_bpm, rec.sleep_hours, rec.bodyweight_kg]
    .filter((v) => v != null).length;
}

export function formatVitalsSlackLine(outcome: VitalsSlackOutcome): string {
  if (outcome.ok) {
    return `vitals-api-import OK · imported ${count(outcome.imported)} of ${count(outcome.attempted)}`;
  }
  return FAILURES[outcome.errorClass] ?? "vitals-api-import FAIL · import failed";
}

export async function postVitalsSlack(
  webhookUrl: string | undefined,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(4_000),
    });
    // Drain the body so a slow response cannot hold the isolate. The bytes
    // are ignored: Slack's reply must not change the import, and must not
    // be logged (it can echo the request).
    await res.text();
  } catch {
    // Expected non-event: Slack being down or slow must not fail the import.
  }
}
