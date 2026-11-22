// http.ts — request shell for report-problem. The user id is the verified
// bearer's `sub` and nothing else (_shared/jwtSubject.ts). That is only safe
// because this function is deployed with JWT verification ON, the default.
// Do not deploy it with --no-verify-jwt.
import { subjectFromAuthHeader } from "../_shared/jwtSubject.ts";
import {
  formatBugSlack,
  parseReport,
  postBugSlack,
  takeSlot,
  type HitStore,
} from "./report.ts";

// sentry-trace and baggage are not optional. supabase.functions.invoke sends
// both, and neither is CORS-safelisted, so a preflight that omits them fails
// and the browser never sends the report (incident #301).
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hits: HitStore = new Map();

export type ServeDeps = {
  env: (key: string) => string | undefined;
  now?: () => number;
  fetch?: typeof fetch;
  hits?: HitStore;
  onError?: (error: unknown, context: Record<string, unknown>) => Promise<void> | void;
};

export async function serveRequest(req: Request, deps: ServeDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const userId = subjectFromAuthHeader(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Expected non-event: an unparseable body is the caller's 400.
    body = null;
  }
  const report = parseReport(body);
  if (!report) return json({ error: "bad_request" }, 400);

  const now = deps.now ?? Date.now;
  const store = deps.hits ?? hits;
  if (!takeSlot(store, userId, now())) return json({ error: "rate_limited" }, 429);

  const webhook = deps.env("SLACK_WEBHOOK_BUGS");
  if (!webhook) {
    await deps.onError?.(new Error("missing env: SLACK_WEBHOOK_BUGS"), {
      missing: ["SLACK_WEBHOOK_BUGS"],
    });
    return json({ error: "unavailable" }, 503);
  }

  const posted = await postBugSlack(
    webhook,
    formatBugSlack(userId, report),
    deps.fetch ?? fetch,
  );
  if (posted !== "sent") {
    await deps.onError?.(new Error("slack delivery failed"), { stage: "slack" });
    return json({ error: "delivery_failed" }, 502);
  }
  return json({ ok: true });
}
