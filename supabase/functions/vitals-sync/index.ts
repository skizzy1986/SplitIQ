// vitals-sync — on-demand Google Health → vitals upsert, user-triggered from the UI.
// Deployed with JWT verification ON (default; do NOT use --no-verify-jwt).
// The gateway verifies the token but admits any genuine project token, including
// one with no user in it. So the handler reads the caller from the verified token
// (_shared/jwtSubject.ts) and serves only VITALS_USER_ID, because the Google Health
// credentials are the owner's only set; everyone else gets 401 or 403 until
// per-user credentials exist (#561).
// Uses the same Google Health credentials as vitals-import-api (no new secrets needed).
//
// Required env (shared with vitals-import-api): GOOGLE_HEALTH_CLIENT_ID,
//   GOOGLE_HEALTH_CLIENT_SECRET, GOOGLE_HEALTH_REFRESH_TOKEN, VITALS_USER_ID,
//   SUPABASE_URL (auto-injected), SUPABASE_SERVICE_ROLE_KEY (auto-injected).
//
// Everything pure lives in sync.ts so test.ts can exercise it without network;
// this file is only the IO around it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { exchangeToken, listDataPoints } from "../vitals-import-api/client.ts";
import { mapResponses } from "../vitals-import-api/mapper.ts";
import { captureFunctionError } from "../_shared/sentry.ts";
import { subjectFromAuthHeader } from "../_shared/jwtSubject.ts";
import {
  buildSpecs,
  CORS,
  coreComplete,
  missingEnv,
  nullFields,
  ownerGate,
  perthYesterday,
  resultStatus,
  upsertParams,
} from "./sync.ts";

const FN = "vitals-sync";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  const refusal = ownerGate(subjectFromAuthHeader(req), Deno.env.get("VITALS_USER_ID"));
  if (refusal) return json(refusal.body, refusal.status);

  const missing = missingEnv((k) => Deno.env.get(k));
  if (missing.length) {
    await captureFunctionError(
      FN,
      new Error(`missing env: ${missing.join(", ")}`),
      { missing },
    );
    return json({ error: "missing env", missing }, 500);
  }
  const env = (k: string) => Deno.env.get(k)!;
  const userId = env("VITALS_USER_ID");

  const supa = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { date, nextDate } = perthYesterday(Date.now());

  const { data: existing } = await supa
    .from("vitals")
    .select("rhr_bpm, hrv_ms, sleep_hours, bodyweight_kg")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (coreComplete(existing)) {
    return json({ ok: true, date, skipped: true });
  }

  let accessToken: string;
  try {
    accessToken = await exchangeToken(
      env("GOOGLE_HEALTH_CLIENT_ID"),
      env("GOOGLE_HEALTH_CLIENT_SECRET"),
      env("GOOGLE_HEALTH_REFRESH_TOKEN"),
    );
  } catch (e) {
    await captureFunctionError(FN, e, { stage: "token-exchange" });
    return json({ error: "token exchange failed", detail: String(e) }, 502);
  }

  const specs = buildSpecs(date, nextDate);
  const settled = await Promise.allSettled(
    specs.map((s) => listDataPoints(accessToken, s.dt, s.filter, s.pageSize)),
  );
  const byKey: Record<string, unknown> = {};
  settled.forEach((r, i) => {
    byKey[specs[i].key] = r.status === "fulfilled" ? r.value : null;
  });

  const rec = mapResponses(
    date,
    byKey.hrv,
    byKey.rhr,
    byKey.sleep,
    byKey.weight,
    byKey.steps,
    byKey.distance,
    byKey.activeMin,
    byKey.calories,
  );

  const { error } = await supa.rpc("upsert_vital", upsertParams(userId, date, rec));
  if (error) {
    await captureFunctionError(FN, new Error(error.message), {
      stage: "upsert_vital",
      date,
    });
    return json({ error: "upsert failed", detail: error.message }, 502);
  }

  const nulls = nullFields(rec);
  return json({ ok: nulls.length === 0, date, record: rec, nullFields: nulls }, resultStatus(nulls));
});
