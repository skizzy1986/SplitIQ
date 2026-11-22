// report-problem — signed-in "Report a problem" posts to Slack.
//
// Deploy with JWT verification ON (the default; do NOT use --no-verify-jwt).
// The gateway validates the bearer before this runs, and the user id is the
// verified `sub`. A user id in the body is ignored, and the email is never read.
//
// The webhook URL is the Supabase secret SLACK_WEBHOOK_BUGS. It is never
// written into a response. The limit below is in memory for this isolate: a
// cold start resets it. A shared table would be a migration, which this does
// not add.

export const BUGS_SLACK_SECRET = "SLACK_WEBHOOK_BUGS";
export const REPORT_LIMIT = 5;
export const REPORT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TEXT = 2000;

const PLATFORMS = new Set(["web", "pwa", "android"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export type Report = {
  what: string;
  steps: string;
  version: string;
  route: string;
  platform: string;
};

export type ReportDeps = {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
  hits: Map<string, number[]>;
  subject: (req: Request) => string | null;
  capture: (error: unknown, context: Record<string, unknown>) => Promise<void>;
};

export function parseReport(body: unknown): { ok: true; report: Report } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const what = typeof b.what === "string" ? b.what.trim() : "";
  const steps = typeof b.steps === "string" ? b.steps.trim() : "";
  const version = typeof b.version === "string" ? b.version.trim() : "";
  const route = typeof b.route === "string" ? b.route.trim() : "";
  const platform = b.platform;
  if (!what || what.length > MAX_TEXT) return { ok: false };
  if (steps.length > MAX_TEXT) return { ok: false };
  if (!version || version.length > 40) return { ok: false };
  if (!route || route.length > 300) return { ok: false };
  if (typeof platform !== "string" || !PLATFORMS.has(platform)) return { ok: false };
  return { ok: true, report: { what, steps, version, route, platform } };
}

// Slack mrkdwn treats <!channel>, <@U…> and <#C…> as mentions. Break those
// prefixes so a report cannot ping the channel. The words themselves stay.
function plain(text: string): string {
  return text.replace(/<([!@#])/g, "< $1");
}

export function reportSlackText(userId: string, report: Report): string {
  const lines = [
    "Report a problem",
    `user: ${userId}`,
    `platform: ${report.platform}`,
    `version: ${plain(report.version)}`,
    `route: ${plain(report.route)}`,
    `what happened: ${plain(report.what)}`,
  ];
  if (report.steps) lines.push(`steps: ${plain(report.steps)}`);
  return lines.join("\n");
}

export function takeSlot(hits: Map<string, number[]>, userId: string, now: number): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < REPORT_WINDOW_MS);
  if (recent.length >= REPORT_LIMIT) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

function withoutUrl(error: unknown): Error {
  const message = error instanceof Error ? error.message : "slack delivery failed";
  return new Error(message.replace(/https?:\/\/\S+/g, "[url]"));
}

export async function handleReportProblem(req: Request, deps: ReportDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const userId = deps.subject(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Not a report: the body was not JSON.
    return json({ error: "invalid report" }, 400);
  }

  const parsed = parseReport(body);
  if (!parsed.ok) return json({ error: "invalid report" }, 400);

  const webhook = deps.env(BUGS_SLACK_SECRET);
  if (!webhook) return json({ error: "not configured" }, 503);

  if (!takeSlot(deps.hits, userId, deps.now())) {
    return json({ error: "rate limited" }, 429);
  }

  const text = reportSlackText(userId, parsed.report);
  try {
    const res = await deps.fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      await deps.capture(new Error(`slack delivery failed: HTTP ${res.status}`), { status: res.status });
      return json({ error: "delivery failed" }, 502);
    }
    await res.body?.cancel();
  } catch (e) {
    await deps.capture(withoutUrl(e), { stage: "slack" });
    return json({ error: "delivery failed" }, 502);
  }

  return json({ ok: true });
}
