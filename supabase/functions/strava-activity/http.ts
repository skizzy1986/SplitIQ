// http.ts — the HTTP shell of strava-activity (#647): CORS, method, the user
// from the verified JWT, env, body parsing and the error envelope. Split out of
// index.ts so test.ts can drive it with a fake client factory: index.ts calls
// Deno.serve at load and value-imports supabase-js, and neither may be in the
// test's module graph.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { refreshAccessToken } from "../strava-import/client.ts";
import type { TokenStore } from "../strava-import/tokens.ts";
import { subjectFromAuthHeader } from "../_shared/jwtSubject.ts";
import { captureFunctionError } from "../_shared/sentry.ts";
import { FN, handleActivityRequest } from "./handler.ts";

// Same header list as strava-sync, strava-connect and vitals-sync, and for the
// same reason: supabase.functions.invoke goes through the Sentry-instrumented
// global fetch, so sentry-trace and baggage appear in the preflight. Dropping
// either fails the OPTIONS and the request is never sent (incident #301).
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export const REQUIRED_ENV = ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

export type ServeDeps = {
  env: (key: string) => string | undefined;
  makeSupa: (url: string, serviceKey: string) => SupabaseClient;
  /** Test seams. */
  store?: TokenStore;
  now?: () => number;
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // no-store: the body is Strava Data, and no browser or proxy cache may
    // keep it beyond the server-side cache's own expiry.
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * `session_id` as a positive integer JSON number, or null. Every other key
 * (activity_id, user_id) is ignored: the activity comes from the link row and
 * the user from the JWT.
 */
export function parseSessionId(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const v = (body as Record<string, unknown>).session_id;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

export async function serveRequest(req: Request, deps: ServeDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS, "Cache-Control": "no-store" } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // From the verified bearer's `sub`, never from the body. Safe only because
  // the function is deployed with JWT verification ON (_shared/jwtSubject.ts).
  const userId = subjectFromAuthHeader(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const missing = REQUIRED_ENV.filter((k) => !deps.env(k));
  if (missing.length) {
    await captureFunctionError(FN, new Error(`missing env: ${missing.join(", ")}`), { missing });
    return json({ error: "missing env", missing }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Expected non-event: an unparseable body is the caller's 400, not ours.
    body = null;
  }
  const sessionId = parseSessionId(body);
  if (sessionId == null) return json({ error: "bad_request" }, 400);

  const clientId = deps.env("STRAVA_CLIENT_ID")!;
  const clientSecret = deps.env("STRAVA_CLIENT_SECRET")!;
  try {
    const result = await handleActivityRequest(
      {
        supa: deps.makeSupa(deps.env("SUPABASE_URL")!, deps.env("SUPABASE_SERVICE_ROLE_KEY")!),
        refresh: (rt) => refreshAccessToken(clientId, clientSecret, rt),
        store: deps.store,
        now: deps.now,
      },
      userId,
      sessionId,
    );
    return json(result.body, result.httpStatus);
  } catch (e) {
    await captureFunctionError(FN, e, { userId, sessionId, stage: "unexpected" });
    return json({ error: "strava_activity_failed" }, 502);
  }
}
