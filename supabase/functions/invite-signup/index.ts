// invite-signup — creates a confirmed account for a tester who holds a valid
// invite code, and lets them choose their own password (#791).
//
// SPLITIQ DEV ONLY. Never deploy this to the production project
// (swdrueaserjzhuxnzmeu): D32 says testers never get a production account. Two
// guards besides this note: INVITE_SIGNUP_ENABLED must be "true" (set it as a
// secret on dev only), and the function refuses when SUPABASE_URL is the
// production project.
//
// Deployed with JWT verification OFF (`supabase functions deploy invite-signup
// --no-verify-jwt --project-ref niytwgtsclzuhyggvbhd`): the caller has no
// session yet, and the newer publishable keys are not JWTs the gateway can
// verify. The function does its own checking: a hashed, limited-use code, a
// rate limit, and the consent tick. Public sign-up stays OFF in the project's
// Auth settings; this function creates users with the admin API.
//
// No email is sent: the account is created confirmed, so the tester signs in
// straight away with the password they chose.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureFunctionError } from "../_shared/sentry.ts";
import { type Claim, handleSignup, isProductionUrl } from "./logic.ts";

const FN = "invite-signup";

// sentry-trace and baggage are not optional: see the note on CORS in
// strava-connect/index.ts (incident #301).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MAX_BODY_BYTES = 4096;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Keyed with the service key, which never leaves the function, so a leaked
// ledger row cannot be turned back into an address by trying every IPv4.
async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function callerAddress(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("cf-connecting-ip") || "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "bad_request" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const enabled = Deno.env.get("INVITE_SIGNUP_ENABLED") === "true" &&
    !!url && !!serviceKey && !isProductionUrl(url);
  if (!enabled) return json({ ok: false, error: "disabled" });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: "bad_request" }, 413);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: "bad_request" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "bad_request" });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const reply = await handleSignup(body, callerAddress(req), {
      enabled,
      ipHash: (ip) => hmacHex(serviceKey, ip),
      now: () => new Date(),
      claim: async (codeHash, email, ipHash): Promise<Claim> => {
        const { data, error } = await admin.rpc("invite_signup_claim", {
          p_code_hash: codeHash,
          p_email: email,
          p_ip_hash: ipHash,
        });
        if (error) throw error;
        return data as Claim;
      },
      release: async (id) => {
        const { error } = await admin.rpc("invite_signup_release", { p_id: id });
        if (error) throw error;
      },
      createUser: async ({ email, password, appMetadata }) => {
        const { error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: appMetadata,
        });
        return error ? { ok: false, code: (error as { code?: string }).code } : { ok: true };
      },
      // Identifiers and the step only: never the email, the code or the password.
      onError: (where, error) => captureFunctionError(FN, error, { where }),
    });
    return json(reply);
  } catch (error) {
    await captureFunctionError(FN, error, { where: "handler" });
    return json({ ok: false, error: "server" }, 500);
  }
});
