// report.ts — pure half of report-problem: validate the body, format the Slack
// line, rate-limit, and post. No JWT and no Deno.serve, so the tests can
// import it without booting the function.

export const REPORT_LIMIT = 5;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
const MAX_WHAT = 2000;
const MAX_STEPS = 2000;
const MAX_VERSION = 40;
const MAX_ROUTE = 200;

const PLATFORMS = ["web", "pwa", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ProblemReport = {
  what: string;
  steps: string | null;
  version: string;
  route: string;
  platform: Platform;
};

export type HitStore = Map<string, number[]>;

function text(value: unknown, max: number, required: boolean): string | null | undefined {
  if (value == null) return required ? undefined : null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  if (!trimmed) return required ? undefined : null;
  return trimmed;
}

// Unknown keys (email, user id) are ignored. The user id comes from the JWT.
export function parseReport(body: unknown): ProblemReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const what = text(raw.what, MAX_WHAT, true);
  const steps = text(raw.steps, MAX_STEPS, false);
  const version = text(raw.version, MAX_VERSION, true);
  const route = text(raw.route, MAX_ROUTE, true);
  const platform = raw.platform;
  if (
    what == null || steps === undefined || version == null || route == null ||
    (platform !== "web" && platform !== "pwa" && platform !== "android")
  ) {
    return null;
  }
  return { what, steps, version, route, platform };
}

export function formatBugSlack(userId: string, report: ProblemReport): string {
  const lines = [
    "Problem report",
    `User: ${userId}`,
    `Version: ${report.version}`,
    `Platform: ${report.platform}`,
    `Screen: ${report.route}`,
    `What happened: ${report.what}`,
  ];
  if (report.steps) lines.push(`Steps: ${report.steps}`);
  return lines.join("\n");
}

// Per-isolate. A cold start forgets the window; that is the basic limiter,
// and it needs no table. `false` means the caller is over the limit.
export function takeSlot(
  store: HitStore,
  userId: string,
  now: number,
  limit = REPORT_LIMIT,
  windowMs = REPORT_WINDOW_MS,
): boolean {
  const fresh = (store.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    store.set(userId, fresh);
    return false;
  }
  fresh.push(now);
  store.set(userId, fresh);
  return true;
}

export async function postBugSlack(
  webhookUrl: string,
  textBody: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"sent" | "failed"> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textBody }),
      signal: AbortSignal.timeout(4_000),
    });
    // Drain and discard. Slack's reply can echo the request, so it is never
    // returned to the client and never logged.
    await res.text();
    return res.ok ? "sent" : "failed";
  } catch {
    // Expected non-event for the caller: the function answers delivery_failed
    // and the webhook URL stays in this frame.
    return "failed";
  }
}
