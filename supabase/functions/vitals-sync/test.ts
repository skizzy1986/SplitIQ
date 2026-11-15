// Assertion script for vitals-sync's pure logic (sync.ts) and the activity half
// of the shared mapper it depends on. Run with `deno run vitals-sync/test.ts`
// from supabase/functions — no network, no env, no Supabase client.
import {
  buildSpecs,
  CORS,
  coreComplete,
  missingEnv,
  nullFields,
  perthYesterday,
  REQUIRED_ENV,
  resultStatus,
  upsertParams,
  ymd,
} from "./sync.ts";
import {
  extractActiveMinutes,
  extractCaloriesKcal,
  extractDistanceMeters,
  extractSteps,
  mapResponses,
} from "../vitals-import-api/mapper.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, actual?: unknown) => {
  if (cond) {
    pass++;
    console.log("  PASS", name);
  } else {
    fail++;
    console.log("  FAIL", name, "->", JSON.stringify(actual));
  }
};

// --- CORS: the preflight must admit Sentry's tracing headers (#301) ---------
const allowHeaders = CORS["Access-Control-Allow-Headers"].split(",").map((h) => h.trim());
for (const h of ["authorization", "x-client-info", "apikey", "content-type", "sentry-trace", "baggage"]) {
  check(`cors: allows ${h}`, allowHeaders.includes(h), allowHeaders);
}
check("cors: allows POST", CORS["Access-Control-Allow-Methods"].includes("POST"), CORS);
check("cors: allows OPTIONS", CORS["Access-Control-Allow-Methods"].includes("OPTIONS"), CORS);
check("cors: preflight cached", Number(CORS["Access-Control-Max-Age"]) > 0, CORS);

// --- missingEnv -------------------------------------------------------------
const full: Record<string, string> = Object.fromEntries(REQUIRED_ENV.map((k) => [k, "x"]));
check("env: none missing", missingEnv((k) => full[k]).length === 0, missingEnv((k) => full[k]));
const noUser: Record<string, string> = { ...full, VITALS_USER_ID: "" };
const m1 = missingEnv((k) => noUser[k]);
check("env: empty string counts as missing", m1.length === 1 && m1[0] === "VITALS_USER_ID", m1);
check("env: all six missing", missingEnv(() => undefined).length === 6, missingEnv(() => undefined));

// --- dates: yesterday in Perth (UTC+8) --------------------------------------
check("ymd pads month/day", ymd(new Date(Date.UTC(2026, 0, 5))) === "2026-01-05", ymd(new Date(Date.UTC(2026, 0, 5))));
// 2026-03-10 15:59 UTC = 23:59 Perth on the 10th -> yesterday is the 9th
const w1 = perthYesterday(Date.UTC(2026, 2, 10, 15, 59));
check("perth: 23:59 Perth -> yesterday 03-09", w1.date === "2026-03-09" && w1.nextDate === "2026-03-10", w1);
// 2026-03-10 16:00 UTC = 00:00 Perth on the 11th -> yesterday is the 10th
const w2 = perthYesterday(Date.UTC(2026, 2, 10, 16, 0));
check("perth: midnight Perth rolls the day", w2.date === "2026-03-10" && w2.nextDate === "2026-03-11", w2);
const w3 = perthYesterday(Date.UTC(2026, 0, 1, 2, 0)); // 10:00 Perth, 1 Jan
check("perth: year boundary", w3.date === "2025-12-31" && w3.nextDate === "2026-01-01", w3);
const w4 = perthYesterday(Date.UTC(2028, 2, 1, 2, 0)); // 10:00 Perth, 1 Mar leap year
check("perth: leap day", w4.date === "2028-02-29" && w4.nextDate === "2028-03-01", w4);

// --- specs ------------------------------------------------------------------
const specs = buildSpecs("2026-03-09", "2026-03-10");
const keys = specs.map((s) => s.key);
check(
  "specs: the eight keys, in mapResponses argument order",
  JSON.stringify(keys) === JSON.stringify(["hrv", "rhr", "sleep", "weight", "steps", "distance", "activeMin", "calories"]),
  keys,
);
check("specs: unique data types", new Set(specs.map((s) => s.dt)).size === specs.length, specs.map((s) => s.dt));
for (const s of specs) {
  check(`specs: ${s.key} filter bounds the day`, s.filter.includes('>= "2026-03-09"') && s.filter.includes('< "2026-03-10"'), s.filter);
  // The Health API rejects camelCase filters; the data-type prefix must be snake_case.
  check(`specs: ${s.key} filter is snake_case`, !/[A-Z]/.test(s.filter.split(" ")[0]), s.filter);
}
check("specs: sleep pages to 25", specs.find((s) => s.key === "sleep")?.pageSize === 25, specs);
check("specs: only sleep sets a page size", specs.filter((s) => s.pageSize).length === 1, specs);

// --- skip rule --------------------------------------------------------------
check("skip: null row -> fetch", coreComplete(null) === false);
check("skip: all four present -> skip", coreComplete({ rhr_bpm: 55, hrv_ms: 40, sleep_hours: 7, bodyweight_kg: 95 }) === true);
check("skip: zero counts as present", coreComplete({ rhr_bpm: 0, hrv_ms: 0, sleep_hours: 0, bodyweight_kg: 0 }) === true);
check("skip: one null -> fetch", coreComplete({ rhr_bpm: 55, hrv_ms: null, sleep_hours: 7, bodyweight_kg: 95 }) === false);

// --- activity extractors (the fields that drifted, #312) --------------------
const stepsResp = { dataPoints: [{ dailySteps: { count: "8000" } }, { dailySteps: { count: 1234 } }] };
const distResp = { dataPoints: [{ dailyDistance: { distanceMeters: 6543.219 } }] };
const activeResp = { dataPoints: [{ dailyActiveMinutes: { minutes: "30" } }, { activeZoneMinutes: { minutes: 12 } }] };
const calResp = { dataPoints: [{ dailyCaloriesExpended: { energyKilocalories: 2450.6 } }] };
check("steps: sums string + number", extractSteps(stepsResp) === 9234, extractSteps(stepsResp));
check("distance: 2 dp", extractDistanceMeters(distResp) === 6543.22, extractDistanceMeters(distResp));
check("active: dailyActiveMinutes + activeZoneMinutes fallback", extractActiveMinutes(activeResp) === 42, extractActiveMinutes(activeResp));
check("calories: rounded", extractCaloriesKcal(calResp) === 2451, extractCaloriesKcal(calResp));
check("steps: null response -> null", extractSteps(null) === null);
check("steps: zero -> null", extractSteps({ dataPoints: [{ dailySteps: { count: 0 } }] }) === null);
check("distance: wrong shape -> null", extractDistanceMeters({ dataPoints: [{ other: {} }] }) === null);

// --- end to end: responses -> record -> upsert args -------------------------
const hrvResp = { dataPoints: [{ dailyHeartRateVariability: { averageHeartRateVariabilityMilliseconds: 38.7 } }] };
const rhrResp = { dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "56" } }] };
const sleepResp = { dataPoints: [{ sleep: { summary: { minutesAsleep: 390 } } }] };
const weightResp = { dataPoints: [{ weight: { weightGrams: 95400 } }] };

const rec = mapResponses("2026-03-09", hrvResp, rhrResp, sleepResp, weightResp, stepsResp, distResp, activeResp, calResp);
const args = upsertParams("user-1", "2026-03-09", rec);
check("upsert: exactly the 11 args of the live overload (#454)", Object.keys(args).length === 11, Object.keys(args));
check(
  "upsert: every arg is defined (an undefined key is dropped from JSON and PostgREST picks the 7-arg overload)",
  Object.values(args).every((v) => v !== undefined),
  args,
);
check("upsert: source tagged", args.p_source === "google_health_api", args.p_source);
check("upsert: core mapped", args.p_rhr === 56 && args.p_hrv === 39 && args.p_sleep === 6.5 && args.p_bodyweight === 95.4, args);
check(
  "upsert: activity mapped",
  args.p_steps === 9234 && args.p_distance === 6543.22 && args.p_active_min === 42 && args.p_calories === 2451,
  args,
);
check("result: complete record -> no null fields", nullFields(rec).length === 0, nullFields(rec));
check("result: complete -> 200", resultStatus(nullFields(rec)) === 200);

// A failed fetch (null) for steps and calories -> partial content.
const partial = mapResponses("2026-03-09", hrvResp, rhrResp, sleepResp, weightResp, null, distResp, activeResp, null);
const pn = nullFields(partial);
check("result: failed fetches reported", JSON.stringify(pn) === JSON.stringify(["steps_count", "calories_kcal"]), pn);
check("result: partial -> 207", resultStatus(pn) === 207);
const pa = upsertParams("user-1", "2026-03-09", partial);
check("upsert: failed fetch sends null, not undefined", pa.p_steps === null && pa.p_calories === null, pa);

console.log("\nRESULT:", pass, "passed,", fail, "failed");
if (fail) Deno.exit(1);
