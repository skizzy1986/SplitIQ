// strava-import test suite. Same hand-rolled harness as vitals-import/test.ts
// and vitals-import-api/test.ts, and run the same way — `deno run --allow-env
// strava-import/test.ts`, NOT `deno test`. These are assertion scripts, not
// Deno.test() cases; `deno test` reports a misleading "0 passed" while still
// honouring the Deno.exit(1) below.
//
// Everything under test is pure. There is no network, no database and no
// dependence on the machine's clock or timezone — which is the point: the three
// things most likely to go silently wrong in this feature (the log date, the
// dedupe decision, and the refresh-token rotation) are exactly the three that
// are cheapest to get right here and most expensive to discover in production.
import {
  avgHrOrNull,
  avgWattsOrNull,
  hasUsableDeviceWatts,
  buildLabel,
  ELIGIBLE_SPORT_TYPES,
  isGarminRecorded,
  chooseAdoptionCandidate,
  distanceTolerance,
  formatDuration,
  isEligible,
  localTimeHHMM,
  mapActivityToSession,
  needsDetailFetch,
  toLogDateFromLocal,
  typeFamily,
  type AdoptionCandidate,
  type StravaActivity,
} from "./mapper.ts";
import {
  advanceBackfillCursor,
  advanceIncrementalWatermark,
  isDailyCapExhausted,
  isNearDailyCap,
  mergeStopReason,
  nextQuarterHour,
  nextUtcMidnight,
  shouldStopChunk,
} from "./state.ts";
import { EMPTY_RATE_LIMIT, parseRateLimit, StravaAuthError, StravaHttpError, type StravaTokens } from "./client.ts";
import { getFreshAccessToken, type RotatedTokens, type StoredTokens, type TokenStore } from "./tokens.ts";
import { checkCronSecret } from "../_shared/cronGuard.ts";
import { runImport } from "./importer.ts";

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

// A test-only floor. The live value is STRAVA_BACKFILL_FROM config, not a test input.
const BACKFILL_FROM = "2026-01-01";

// ---------------------------------------------------------------------------
// Fixtures — synthetic. Ids, times and figures are made up; only the shapes
// and the edge cases they encode are taken from real Strava payloads.
//   rowing      — an evening session (UTC+8), whose UTC date is the same day.
//   virtualRide — just after local midnight, so its UTC date is the day BEFORE
//                 its local date. A Date-based log date gets this one wrong.
//   Watts round up and heart rate rounds down, so both directions are covered.
// ---------------------------------------------------------------------------

const rowing: StravaActivity = {
  id: 10000000001,
  name: "Evening Rowing",
  sport_type: "Rowing",
  start_date: "2026-01-05T12:30:45Z",
  start_date_local: "2026-01-05T20:30:45",
  distance: 6000.4,
  moving_time: 1500,
  average_watts: 149.6,
  has_device_watts: true,
  average_heartrate: 130.4,
  has_heartrate: true,
};

const virtualRide: StravaActivity = {
  id: 10000000002,
  name: "Virtual Ride",
  sport_type: "VirtualRide",
  start_date: "2026-01-05T16:30:15Z",
  start_date_local: "2026-01-06T00:30:15",
  distance: 30000.4,
  moving_time: 3615,
  average_watts: 200.4,
  has_device_watts: true,
  average_heartrate: 140.4,
  has_heartrate: true,
};

const act = (over: Partial<StravaActivity>): StravaActivity => ({ ...rowing, ...over });

// ---------------------------------------------------------------------------
// TC-01 — sport_type is an ALLOW-list
// ---------------------------------------------------------------------------
console.log("\nTC-01 eligibility allow-list");

check("TC-01 Rowing accepted", isEligible(rowing, BACKFILL_FROM).eligible === true);
check("TC-01 VirtualRide accepted", isEligible(virtualRide, BACKFILL_FROM).eligible === true);
for (const sport of ["WeightTraining", "Walk", "Workout", "Run", "Yoga", "Rowing "]) {
  const v = isEligible(act({ sport_type: sport }), BACKFILL_FROM);
  check(`TC-01 ${sport} rejected as sport_type`, v.eligible === false && v.reason === "sport_type", v);
}
check(
  "TC-01 before backfill_from rejected",
  isEligible(act({ start_date_local: "2025-12-31T06:00:00" }), BACKFILL_FROM).reason ===
    "before_backfill_from",
);
check(
  "TC-01 on backfill_from accepted (boundary is inclusive)",
  isEligible(act({ start_date_local: "2026-01-01T06:00:00" }), BACKFILL_FROM).eligible === true,
);

// ---------------------------------------------------------------------------
// TC-02 — the duration and distance floors
// ---------------------------------------------------------------------------
console.log("\nTC-02 fragment floors");

for (const secs of [5, 15, 30, 60, 119]) {
  const v = isEligible(act({ moving_time: secs }), BACKFILL_FROM);
  check(`TC-02 ${secs}s fragment rejected`, v.eligible === false && v.reason === "moving_time", v);
}
for (const metres of [10, 50, 100, 150, 199]) {
  const v = isEligible(act({ distance: metres, moving_time: 600 }), BACKFILL_FROM);
  check(`TC-02 ${metres}m fragment rejected`, v.eligible === false && v.reason === "distance", v);
}
// The floors exist to drop bumped-PM5 fragments, NOT short hard efforts.
const cpTest = act({ name: "CP Test", moving_time: 240, distance: 1080 });
check("TC-02 CP Test (240 s / 1080 m) ACCEPTED", isEligible(cpTest, BACKFILL_FROM).eligible === true,
  isEligible(cpTest, BACKFILL_FROM));
check("TC-02 exactly 120 s accepted", isEligible(act({ moving_time: 120 }), BACKFILL_FROM).eligible === true);
check("TC-02 exactly 200 m accepted",
  isEligible(act({ distance: 200, moving_time: 600 }), BACKFILL_FROM).eligible === true);

// ---------------------------------------------------------------------------
// TC-03 — the full mapping contract on the rowing fixture
// ---------------------------------------------------------------------------
console.log("\nTC-03 mapActivityToSession on synthetic activity 10000000001");

const mapped = mapActivityToSession(rowing);
check("TC-03 date 1/5/26",         mapped.date === "1/5/26",         mapped.date);
check("TC-03 type erg",            mapped.type === "erg",            mapped.type);
check("TC-03 duration 25:00",      mapped.duration === "25:00",      mapped.duration);
check("TC-03 distance_m 6000",     mapped.distance_m === 6000,       mapped.distance_m);
check("TC-03 avg_watts 150",       mapped.avg_watts === 150,         mapped.avg_watts);
check("TC-03 avg_hr 130",          mapped.avg_hr === 130,            mapped.avg_hr);
check("TC-03 status completed",    mapped.status === "completed",    mapped.status);
check("TC-03 source strava",       mapped.source === "strava",       mapped.source);
check("TC-03 activity id carried", mapped.strava_activity_id === 10000000001, mapped.strava_activity_id);

const mappedRide = mapActivityToSession(virtualRide);
check("TC-03 VirtualRide type cycling",  mappedRide.type === "cycling",       mappedRide.type);
check("TC-03 VirtualRide date 1/6/26",   mappedRide.date === "1/6/26",        mappedRide.date);
check("TC-03 VirtualRide duration 60:15", mappedRide.duration === "60:15",    mappedRide.duration);
check("TC-03 VirtualRide distance 30000", mappedRide.distance_m === 30000,    mappedRide.distance_m);
check("TC-03 VirtualRide watts 200",      mappedRide.avg_watts === 200,       mappedRide.avg_watts);

// These lower-case spellings are what normType() in web/src/utils/formatting.js
// recognises. 'Rowing' / 'VirtualRide' would render as colourless unknowns.
check("TC-03 type is never Strava's own spelling",
  mapped.type !== "Rowing" && mappedRide.type !== "VirtualRide");

// The mapper must not invent Scott's fields.
const mappedKeys = Object.keys(mapped).sort().join(",");
check("TC-03 no srpe/coach_note/prs/exercises/coach_flag/benchmark_key written",
  !/srpe|coach_note|prs|exercises|coach_flag|benchmark_key/.test(mappedKeys), mappedKeys);

// ---------------------------------------------------------------------------
// TC-04 — no estimated power, no invented heart rate
// ---------------------------------------------------------------------------
console.log("\nTC-04 device watts and heart rate are never estimated");

const noDevice = act({ has_device_watts: false, average_watts: 210 });
check("TC-04 has_device_watts false -> avg_watts null", mapActivityToSession(noDevice).avg_watts === null,
  mapActivityToSession(noDevice).avg_watts);
const absentFlag = act({ has_device_watts: undefined, device_watts: undefined, average_watts: 210 });
check("TC-04 flag absent -> avg_watts null", avgWattsOrNull(absentFlag) === null, avgWattsOrNull(absentFlag));
check("TC-04 device_watts spelling also accepted",
  avgWattsOrNull(act({ has_device_watts: undefined, device_watts: true, average_watts: 210 })) === 210);
// Adoption overwrites avg_watts whenever the device-watts flag is set, so the
// flag alone is not a safe gate: a payload claiming device watts with no numeric
// average_watts would write NULL over a value the adopted row already had.
check("TC-04 usable-watts gate true when flag AND number present",
  hasUsableDeviceWatts(act({ has_device_watts: true, average_watts: 200 })) === true);
check("TC-04 USABLE-WATTS GATE FALSE WHEN FLAG SET BUT VALUE MISSING",
  hasUsableDeviceWatts(act({ has_device_watts: true, average_watts: null })) === false);
check("TC-04 usable-watts gate false when value is not a number",
  hasUsableDeviceWatts(act({ has_device_watts: true, average_watts: undefined })) === false);
check("TC-04 usable-watts gate false when no device watts at all",
  hasUsableDeviceWatts(act({ has_device_watts: false, average_watts: 200 })) === false);

const noHr = act({ has_heartrate: false, average_heartrate: 150 });
check("TC-04 has_heartrate false -> avg_hr null", mapActivityToSession(noHr).avg_hr === null,
  mapActivityToSession(noHr).avg_hr);
check("TC-04 has_heartrate true but no value -> null",
  avgHrOrNull(act({ has_heartrate: true, average_heartrate: null })) === null);
// Nothing anywhere may derive watts from pace as a substitute.
check("TC-04 no estimate substituted for missing power",
  mapActivityToSession(act({ has_device_watts: false, average_watts: 210, distance: 5000, moving_time: 1200 }))
    .avg_watts === null);

// needsDetailFetch — the gate that decides whether a summary is worth writing
// at all. The SummaryActivity from /athlete/activities does not reliably carry
// power or heart rate (verified against a real rowing activity: the list
// payload had neither, the detail payload had both), and a session imported without them scores 0 in
// sessionLoad(), so it would contribute nothing to CTL/ATL/TSB.
check("TC-04 a summary with no watts and no HR needs detail",
  needsDetailFetch(act({ average_watts: undefined, has_device_watts: undefined,
    average_heartrate: undefined, has_heartrate: undefined })) === true);
check("TC-04 a summary with HR but no device watts still needs detail",
  needsDetailFetch(act({ average_watts: undefined, has_device_watts: undefined })) === true);
check("TC-04 a summary with device watts but no HR still needs detail",
  needsDetailFetch(act({ average_heartrate: undefined, has_heartrate: undefined })) === true);
check("TC-04 a summary carrying BOTH (and a device name) needs no detail fetch",
  needsDetailFetch({ ...rowing, device_name: "Concept2 PM5" }) === false &&
    needsDetailFetch({ ...virtualRide, device_name: "Zwift" }) === false);
check("TC-04 a summary missing distance/moving_time/date needs detail",
  needsDetailFetch(act({ distance: undefined })) === true &&
  needsDetailFetch(act({ moving_time: undefined })) === true &&
  needsDetailFetch(act({ start_date_local: undefined })) === true);
// A read spent on a sport we discard is a read taken from one that counts.
for (const sport of ["WeightTraining", "Run", "Walk", "Handcycle"]) {
  check(`TC-04 ${sport} never costs a detail fetch`,
    needsDetailFetch(act({ sport_type: sport, average_watts: undefined,
      has_device_watts: undefined, has_heartrate: undefined })) === false);
}

// ---------------------------------------------------------------------------
// TC-05 — same-day, same-name activities get distinct, watt-free labels
// ---------------------------------------------------------------------------
console.log("\nTC-05 labels");

const morning = act({ id: 1, name: "Row", start_date_local: "2026-01-05T05:15:00" });
const evening = act({ id: 2, name: "Row", start_date_local: "2026-01-05T18:45:00" });
const lm = buildLabel(morning), le = buildLabel(evening);
check("TC-05 same day + same name -> distinct labels", lm !== le, [lm, le]);
check("TC-05 morning label", lm === "Row 05:15", lm);
check("TC-05 evening label", le === "Row 18:45", le);
for (const l of [lm, le, buildLabel(rowing)]) {
  // A watts figure in the label is exactly what breaks dedupe today: the label
  // changes whenever the power does, so one session reads as two.
  check(`TC-05 label carries no watts figure: ${l}`, !/\d+\s*w\b/i.test(l) && !/watt/i.test(l), l);
}
check("TC-05 blank name falls back to sport type",
  buildLabel(act({ name: "   ", start_date_local: "2026-01-05T20:30:45" })) === "Strava Rowing 20:30",
  buildLabel(act({ name: "   " })));
const longName = "x".repeat(400);
const longLabel = buildLabel(act({ name: longName, start_date_local: "2026-01-05T20:30:45" }));
check("TC-05 long label truncated to 120", longLabel.length <= 120, longLabel.length);
check("TC-05 truncation keeps the time suffix (what keeps same-day labels distinct)",
  longLabel.endsWith(" 20:30"), longLabel.slice(-10));

// ---------------------------------------------------------------------------
// TC-06 — buildLabel is deterministic
// ---------------------------------------------------------------------------
console.log("\nTC-06 label determinism");

check("TC-06 byte-identical across two calls", buildLabel(rowing) === buildLabel(rowing));
check("TC-06 byte-identical across two equal inputs",
  buildLabel(rowing) === buildLabel({ ...rowing }));
check("TC-06 unaffected by power changing",
  buildLabel(rowing) === buildLabel(act({ average_watts: 999, has_device_watts: false })));

// ---------------------------------------------------------------------------
// TC-07 — the adoption pass picks the right existing session
// ---------------------------------------------------------------------------
console.log("\nTC-07 chooseAdoptionCandidate");

check("TC-07 typeFamily maps the five real spellings",
  typeFamily("erg") === "erg" && typeFamily("Z2 Aerobic") === "erg" && typeFamily("Rowing") === "erg" &&
  typeFamily("Cycling") === "cycling" && typeFamily("bike") === "cycling" && typeFamily("Ride") === "cycling",
);
check("TC-07 typeFamily rejects strength", typeFamily("Upper Strength") === null, typeFamily("Upper Strength"));

// Pair 1: activity 10000 m vs a hand-filed 9998 m (2 m apart).
const aPair1 = act({ id: 86, distance: 10000, start_date_local: "2026-01-07T05:30:00" });
const cPair1: AdoptionCandidate = { id: 861, date_iso: "2026-01-07", type: "Z2 Aerobic", distance_m: 9998 };
const dPair1 = chooseAdoptionCandidate(aPair1, [cPair1]);
check("TC-07 2 m apart -> adopt", dPair1.decision === "adopt" && dPair1.sessionId === 861, dPair1);

// Pair 2: activity 8005.2 m vs a hand-filed 8000 m (5.2 m apart).
const aPair2 = act({ id: 73, distance: 8005.2, start_date_local: "2026-01-08T05:30:00" });
const cPair2: AdoptionCandidate = { id: 731, date_iso: "2026-01-08", type: "erg", distance_m: 8000 };
const dPair2 = chooseAdoptionCandidate(aPair2, [cPair2]);
check("TC-07 5.2 m apart -> adopt", dPair2.decision === "adopt" && dPair2.sessionId === 731, dPair2);

// The +/-1 day window: hand-filed rows are sometimes a day off the local date.
const dayBefore = chooseAdoptionCandidate(aPair1, [{ ...cPair1, date_iso: "2026-01-06" }]);
check("TC-07 candidate one day EARLIER -> adopt", dayBefore.decision === "adopt", dayBefore);
const dayAfter = chooseAdoptionCandidate(aPair1, [{ ...cPair1, date_iso: "2026-01-08" }]);
check("TC-07 candidate one day LATER -> adopt", dayAfter.decision === "adopt", dayAfter);
const twoDays = chooseAdoptionCandidate(aPair1, [{ ...cPair1, date_iso: "2026-01-09" }]);
check("TC-07 candidate two days out -> insert", twoDays.decision === "insert", twoDays);

check("TC-07 no candidates -> insert", chooseAdoptionCandidate(aPair1, []).decision === "insert");
check("TC-07 wrong family -> insert",
  chooseAdoptionCandidate(aPair1, [{ ...cPair1, type: "Cycling" }]).decision === "insert");
check("TC-07 null distance candidate ignored -> insert",
  chooseAdoptionCandidate(aPair1, [{ ...cPair1, distance_m: null }]).decision === "insert");
check("TC-07 outside tolerance -> insert",
  chooseAdoptionCandidate(aPair1, [{ ...cPair1, distance_m: 10000 - 200 }]).decision === "insert");
check("TC-07 tolerance floor is 5 m for short pieces", distanceTolerance(500) === 5, distanceTolerance(500));
check("TC-07 tolerance is 0.5% above the floor", distanceTolerance(10000) === 50, distanceTolerance(10000));
// A cycling activity must not adopt a rowing session of the same distance.
const aRide = act({ id: 99, sport_type: "VirtualRide", distance: 10000, start_date_local: "2026-01-07T05:30:00" });
check("TC-07 cycling activity ignores erg candidate",
  chooseAdoptionCandidate(aRide, [cPair1]).decision === "insert");

// ---------------------------------------------------------------------------
// TC-08 — two plausible candidates means do nothing at all
// ---------------------------------------------------------------------------
console.log("\nTC-08 ambiguity is never resolved by guessing");

const twoInTolerance = chooseAdoptionCandidate(aPair1, [
  cPair1,
  { id: 862, date_iso: "2026-01-07", type: "erg", distance_m: 10001 },
]);
check("TC-08 two candidates -> ambiguous", twoInTolerance.decision === "ambiguous", twoInTolerance);
check("TC-08 ambiguous never carries a sessionId",
  !("sessionId" in twoInTolerance), twoInTolerance);
check("TC-08 both matches reported for the human to resolve",
  twoInTolerance.matches.length === 2, twoInTolerance.matches.length);
const threeCandidates = chooseAdoptionCandidate(aPair1, [
  cPair1,
  { id: 862, date_iso: "2026-01-06", type: "erg", distance_m: 9999 },
  { id: 863, date_iso: "2026-01-08", type: "Z2 Aerobic", distance_m: 10000 },
]);
check("TC-08 three candidates -> ambiguous", threeCandidates.decision === "ambiguous", threeCandidates);
// One in tolerance and one out is NOT ambiguous — the out-of-tolerance row is
// simply not a match.
const oneIn = chooseAdoptionCandidate(aPair1, [cPair1, { id: 864, date_iso: "2026-01-07", type: "erg", distance_m: 9000 }]);
check("TC-08 one in tolerance, one far out -> adopt", oneIn.decision === "adopt", oneIn);

// ---------------------------------------------------------------------------
// TC-09 — the log date is derived by slicing, never by constructing a Date
// ---------------------------------------------------------------------------
console.log("\nTC-09 timezone-free log date");

check("TC-09 20:30 local -> 1/5/26", toLogDateFromLocal("2026-01-05T20:30:45") === "1/5/26",
  toLogDateFromLocal("2026-01-05T20:30:45"));
// These are the cases a `new Date(local)` implementation gets wrong: Deno runs
// in UTC, so an evening Perth session (UTC+8) would roll back a day and an
// early-morning one would not, misfiling sessions into the wrong training week.
check("TC-09 23:59 local stays on its own day", toLogDateFromLocal("2026-01-05T23:59:59") === "1/5/26");
check("TC-09 00:00 local stays on its own day", toLogDateFromLocal("2026-01-06T00:00:00") === "1/6/26");
check("TC-09 04:45 local (5am erg) stays put", toLogDateFromLocal("2026-06-14T04:45:00") === "6/14/26");
check("TC-09 month and day are UNPADDED", toLogDateFromLocal("2026-01-05T06:00:00") === "1/5/26",
  toLogDateFromLocal("2026-01-05T06:00:00"));
check("TC-09 two-digit year", toLogDateFromLocal("2026-12-31T22:00:00") === "12/31/26");
check("TC-09 result is independent of the process timezone",
  toLogDateFromLocal("2026-01-05T20:30:45") === "1/5/26" &&
  toLogDateFromLocal("2026-01-06T00:30:15") === mapActivityToSession(virtualRide).date);
check("TC-09 localTimeHHMM slices chars 11-16", localTimeHHMM("2026-01-05T20:30:45") === "20:30",
  localTimeHHMM("2026-01-05T20:30:45"));
// Direct evidence the implementation does not go through Date: a stamp Date
// would reject entirely still slices correctly.
check("TC-09 an unparseable-by-Date stamp still slices",
  toLogDateFromLocal("2026-02-30T10:00:00") === "2/30/26",
  toLogDateFromLocal("2026-02-30T10:00:00"));

// ---------------------------------------------------------------------------
// TC-10 — duration formatting
// ---------------------------------------------------------------------------
console.log("\nTC-10 formatDuration");

check("TC-10 1500 -> 25:00", formatDuration(1500) === "25:00", formatDuration(1500));
check("TC-10 2465 -> 41:05", formatDuration(2465) === "41:05", formatDuration(2465));
check("TC-10 4650 -> 77:30", formatDuration(4650) === "77:30", formatDuration(4650));
check("TC-10 seconds are zero padded", formatDuration(61) === "1:01", formatDuration(61));
check("TC-10 minutes are NOT zero padded", formatDuration(540) === "9:00", formatDuration(540));
check("TC-10 0 -> 0:00", formatDuration(0) === "0:00", formatDuration(0));
check("TC-10 240 (CP Test) -> 4:00", formatDuration(240) === "4:00", formatDuration(240));

// ---------------------------------------------------------------------------
// TC-11 — the backfill cursor only ever moves backwards
// ---------------------------------------------------------------------------
console.log("\nTC-11 backfill cursor monotonicity");

let cursor: number | null = 1_800_000_000;
const pages = [
  [1_799_000_000, 1_798_500_000, 1_799_500_000],
  [1_798_000_000, 1_797_000_000],
  [1_796_000_000],
];
let monotonic = true;
for (const page of pages) {
  const next = advanceBackfillCursor(cursor, page);
  if (next == null || cursor == null || next >= cursor) monotonic = false;
  cursor = next;
}
check("TC-11 cursor strictly decreases across pages", monotonic && cursor === 1_796_000_000, cursor);
check("TC-11 picks the OLDEST activity on the page",
  advanceBackfillCursor(1_800_000_000, [1_799_000_000, 1_798_500_000]) === 1_798_500_000);
// The terminator: a page whose activities all sit at or after the cursor would
// otherwise re-list for ever.
check("TC-11 page not older than cursor still steps back",
  advanceBackfillCursor(1_800_000_000, [1_800_000_000, 1_800_500_000]) === 1_799_999_999);
check("TC-11 empty page still steps back",
  advanceBackfillCursor(1_800_000_000, []) === 1_799_999_999);
check("TC-11 null cursor seeds from the page", advanceBackfillCursor(null, [1_700_000_000]) === 1_700_000_000);
check("TC-11 NaN timestamps ignored",
  advanceBackfillCursor(1_800_000_000, [NaN, 1_799_000_000]) === 1_799_000_000);

// The incremental watermark moves the other way, over EVERYTHING seen — a week
// of nothing but WeightTraining must still advance it.
check("TC-11 incremental watermark advances forwards",
  advanceIncrementalWatermark(1_700_000_000, [1_700_500_000, 1_700_200_000]) === 1_700_500_000);
check("TC-11 incremental watermark never goes backwards",
  advanceIncrementalWatermark(1_700_000_000, [1_699_000_000]) === 1_700_000_000);
check("TC-11 incremental watermark unchanged on an empty page",
  advanceIncrementalWatermark(1_700_000_000, []) === 1_700_000_000);

// ---------------------------------------------------------------------------
// TC-12 — the three stop conditions are independent
// ---------------------------------------------------------------------------
console.log("\nTC-12 shouldStopChunk");

const budget = { maxCalls: 50, maxElapsedMs: 20_000 };
const noLimit = EMPTY_RATE_LIMIT;

check("TC-12 fresh run does not stop", shouldStopChunk(0, 0, noLimit, budget).stop === false);
check("TC-12 49 calls does not stop", shouldStopChunk(49, 0, noLimit, budget).stop === false);
const byCalls = shouldStopChunk(50, 0, noLimit, budget);
check("TC-12 50 calls stops on 'calls'", byCalls.stop && byCalls.reason === "calls", byCalls);
const byTime = shouldStopChunk(0, 20_000, noLimit, budget);
check("TC-12 20 s stops on 'elapsed'", byTime.stop && byTime.reason === "elapsed", byTime);
check("TC-12 19.9 s does not stop", shouldStopChunk(0, 19_999, noLimit, budget).stop === false);

const at80 = { ...EMPTY_RATE_LIMIT, shortLimit: 200, shortUsage: 160, source: "read" as const };
const at79 = { ...EMPTY_RATE_LIMIT, shortLimit: 200, shortUsage: 159, source: "read" as const };
const byQuota = shouldStopChunk(0, 0, at80, budget);
check("TC-12 80% of the 15-minute quota stops on 'rate_limit'",
  byQuota.stop && byQuota.reason === "rate_limit", byQuota);
check("TC-12 just under 80% does not stop", shouldStopChunk(0, 0, at79, budget).stop === false);
check("TC-12 absent rate-limit headers never stop the run",
  shouldStopChunk(0, 0, noLimit, budget).stop === false);
check("TC-12 quota trips even with calls and time to spare",
  shouldStopChunk(1, 10, at80, budget).reason === "rate_limit");

// The ceiling is read from the response, not hardcoded.
const rl = parseRateLimit(new Headers({ "X-RateLimit-Limit": "200,2000", "X-RateLimit-Usage": "57,913" }));
check("TC-12 parseRateLimit reads limit/usage pairs",
  rl.shortLimit === 200 && rl.dailyLimit === 2000 && rl.shortUsage === 57 && rl.dailyUsage === 913, rl);
check("TC-12 parseRateLimit prefers the read-specific headers",
  parseRateLimit(new Headers({
    "X-RateLimit-Limit": "200,2000",
    "X-ReadRateLimit-Limit": "100,1000",
    "X-ReadRateLimit-Usage": "90,500",
  })).source === "read");
check("TC-12 parseRateLimit tolerates missing headers",
  parseRateLimit(new Headers({})).shortLimit === null);
// A quota read from headers must actually drive the stop decision.
check("TC-12 a header-derived 90/100 stops the chunk",
  shouldStopChunk(0, 0, parseRateLimit(new Headers({
    "X-ReadRateLimit-Limit": "100,1000",
    "X-ReadRateLimit-Usage": "90,500",
  })), budget).reason === "rate_limit");

check("TC-12 nextQuarterHour rounds up to :15",
  nextQuarterHour(Date.parse("2026-08-22T10:07:31Z")) === Date.parse("2026-08-22T10:15:00Z"));
check("TC-12 nextQuarterHour on an exact boundary returns the NEXT one",
  nextQuarterHour(Date.parse("2026-08-22T10:15:00Z")) === Date.parse("2026-08-22T10:30:00Z"));
check("TC-12 nextQuarterHour crosses the hour",
  nextQuarterHour(Date.parse("2026-08-22T10:52:00Z")) === Date.parse("2026-08-22T11:00:00Z"));

// ---------------------------------------------------------------------------
// TC-13 / TC-14 — refresh token rotation
// ---------------------------------------------------------------------------
console.log("\nTC-13/14 refresh token rotation and revocation");

const NOW = Date.parse("2026-08-28T00:00:00Z");
const EXPIRED = new Date(NOW - 60_000).toISOString();
const VALID = new Date(NOW + 6 * 3600_000).toISOString();

function makeStore(initial: StoredTokens | null) {
  let row: StoredTokens | null = initial ? { ...initial } : null;
  const calls = { read: 0, rotate: 0, rotateRejected: 0, remove: 0 };
  const store: TokenStore = {
    read: (_u: string) => {
      calls.read++;
      return Promise.resolve(row ? { ...row } : null);
    },
    // Mirrors the real CAS: writes ONLY when the stored refresh token still
    // equals the one presented.
    rotate: (_u: string, expected: string, next: RotatedTokens) => {
      calls.rotate++;
      if (!row || row.refresh_token !== expected) {
        calls.rotateRejected++;
        return Promise.resolve(false);
      }
      row = { ...row, ...next };
      return Promise.resolve(true);
    },
    remove: (_u: string) => {
      calls.remove++;
      row = null;
      return Promise.resolve();
    },
  };
  return { store, calls, current: () => row, set: (r: StoredTokens | null) => { row = r; } };
}

const seed: StoredTokens = {
  athlete_id: 4242,
  access_token: "A1",
  refresh_token: "R1",
  expires_at: EXPIRED,
  scope: "activity:read_all",
};
const tokenResponse = (access: string, refresh: string): StravaTokens => ({
  access_token: access,
  refresh_token: refresh,
  expires_at: Math.floor((NOW + 6 * 3600_000) / 1000),
  athlete_id: 4242,
  scope: "activity:read_all",
});

// A still-valid token is used as is — no refresh, no write.
{
  const s = makeStore({ ...seed, expires_at: VALID });
  const r = await getFreshAccessToken(s.store, () => {
    throw new Error("must not refresh a still-valid token");
  }, "u", NOW);
  check("TC-13 valid token reused without refreshing",
    r.status === "ok" && r.accessToken === "A1" && r.rotated === false && s.calls.rotate === 0, r);
}

// TC-13: the rotated refresh token is persisted, and used on the NEXT refresh.
{
  const s = makeStore(seed);
  const presented: string[] = [];
  const refresh = (rt: string) => {
    presented.push(rt);
    return Promise.resolve(tokenResponse(`A${presented.length + 1}`, `R${presented.length + 1}`));
  };

  const r1 = await getFreshAccessToken(s.store, refresh, "u", NOW);
  check("TC-13 refresh returns the new access token",
    r1.status === "ok" && r1.accessToken === "A2" && r1.rotated === true, r1);
  check("TC-13 ROTATED REFRESH TOKEN IS PERSISTED", s.current()?.refresh_token === "R2",
    s.current()?.refresh_token);
  check("TC-13 stored access token replaced too", s.current()?.access_token === "A2");
  check("TC-13 CAS presented the token it had read", presented[0] === "R1", presented);

  // Force another refresh; the rotated token must be the one presented.
  s.set({ ...(s.current() as StoredTokens), expires_at: EXPIRED });
  const r2 = await getFreshAccessToken(s.store, refresh, "u", NOW);
  check("TC-13 NEXT REFRESH USES THE ROTATED TOKEN", presented[1] === "R2", presented);
  check("TC-13 second rotation persisted", s.current()?.refresh_token === "R3" && r2.status === "ok",
    s.current()?.refresh_token);
  check("TC-13 row never deleted on a healthy rotation", s.calls.remove === 0);
}

// TC-13 (race): the CAS loses, so the winner's stored token is used and the
// winner's rotation is NOT overwritten.
{
  const s = makeStore(seed);
  const refresh = (_rt: string) => {
    // Another worker rotates while our HTTP call is in flight.
    s.set({ ...seed, access_token: "WINNER", refresh_token: "RW", expires_at: VALID });
    return Promise.resolve(tokenResponse("LOSER", "RL"));
  };
  const r = await getFreshAccessToken(s.store, refresh, "u", NOW);
  check("TC-13 CAS rejected when another worker rotated first", s.calls.rotateRejected === 1, s.calls);
  check("TC-13 loser uses the winner's access token",
    r.status === "ok" && r.accessToken === "WINNER" && r.rotated === false, r);
  check("TC-13 winner's refresh token NOT overwritten", s.current()?.refresh_token === "RW",
    s.current()?.refresh_token);
}

// TC-14: one invalid_grant is a lost race, not a revocation.
{
  const s = makeStore(seed);
  let attempts = 0;
  const refresh = (rt: string) => {
    attempts++;
    if (attempts === 1) {
      // The winner already rotated R1 out; our presented token is dead.
      s.set({ ...seed, refresh_token: "R2", access_token: "A2" });
      return Promise.reject(new StravaAuthError("invalid_grant"));
    }
    check("TC-14 retry presents the FRESHLY READ token", rt === "R2", rt);
    return Promise.resolve(tokenResponse("A3", "R3"));
  };
  const r = await getFreshAccessToken(s.store, refresh, "u", NOW);
  check("TC-14 single invalid_grant RETRIES rather than deleting",
    r.status === "ok" && attempts === 2 && s.calls.remove === 0, { r, attempts, calls: s.calls });
  check("TC-14 the retry's rotation is persisted", s.current()?.refresh_token === "R3",
    s.current()?.refresh_token);
}

// TC-14: two consecutive invalid_grants IS a revocation.
{
  const s = makeStore(seed);
  let attempts = 0;
  const refresh = (_rt: string) => {
    attempts++;
    return Promise.reject(new StravaAuthError("invalid_grant"));
  };
  const r = await getFreshAccessToken(s.store, refresh, "u", NOW);
  check("TC-14 two consecutive invalid_grants -> auth_failed", r.status === "auth_failed", r);
  check("TC-14 exactly two attempts, not more", attempts === 2, attempts);
  check("TC-14 the row is deleted only then", s.calls.remove === 1 && s.current() === null, s.calls);
}

// A 5xx or a network fault must never destroy the connection.
{
  const s = makeStore(seed);
  const r = await getFreshAccessToken(s.store, () => Promise.reject(new StravaHttpError(503, "token refresh")),
    "u", NOW);
  check("TC-14 non-auth failure -> refresh_failed", r.status === "refresh_failed", r);
  check("TC-14 non-auth failure NEVER deletes the row", s.calls.remove === 0 && s.current() !== null, s.calls);
}
{
  const s = makeStore(null);
  const r = await getFreshAccessToken(s.store, () => Promise.reject(new Error("unused")), "u", NOW);
  check("TC-14 no stored row -> not_connected", r.status === "not_connected", r);
}
{
  const s = makeStore({ ...seed, expires_at: "not-a-date" });
  let attempts = 0;
  const r = await getFreshAccessToken(s.store, (_rt) => {
    attempts++;
    return Promise.resolve(tokenResponse("A9", "R9"));
  }, "u", NOW);
  check("TC-14 unparseable expiry refreshes rather than assuming valid",
    attempts === 1 && r.status === "ok", { attempts, r });
}

// ---------------------------------------------------------------------------
// TC-15 — the cron guard, re-verified for the copy in _shared/
// ---------------------------------------------------------------------------
console.log("\nTC-15 cron guard");

const CRON_ENV = "STRAVA_CRON_SECRET";
const saved = Deno.env.get(CRON_ENV);
const savedShared = Deno.env.get("CRON_SECRET");

const mockReq = (headerValue?: string) =>
  new Request("http://localhost/", {
    headers: headerValue === undefined ? {} : { "x-cron-secret": headerValue },
  });

// 1. secret unset entirely -> 401, regardless of header
Deno.env.delete(CRON_ENV);
check("TC-15 secret unset -> 401", checkCronSecret(mockReq("anything"), CRON_ENV)?.status === 401);

// 2. secret set to "" -> 401 (fail closed), even with a matching-looking header
Deno.env.set(CRON_ENV, "");
check("TC-15 secret empty, header empty -> 401", checkCronSecret(mockReq(""), CRON_ENV)?.status === 401);
check("TC-15 secret empty, header set -> 401", checkCronSecret(mockReq("whatever"), CRON_ENV)?.status === 401);

const REAL_SECRET = "s3cret-value-123-xyz";
Deno.env.set(CRON_ENV, REAL_SECRET);

// 3. header missing entirely -> 401
check("TC-15 header missing -> 401", checkCronSecret(mockReq(undefined), CRON_ENV)?.status === 401);

// 4. header present but empty -> 401
check("TC-15 header empty -> 401", checkCronSecret(mockReq(""), CRON_ENV)?.status === 401);

// 5. header wrong, same length as secret -> 401, must not throw
check("TC-15 header wrong (same length) -> 401",
  checkCronSecret(mockReq("x".repeat(REAL_SECRET.length)), CRON_ENV)?.status === 401);

// 6. header wrong, different length -> 401 (the case that breaks a naive
//    timingSafeEqual call on unequal-length buffers)
check("TC-15 header wrong (different length) -> 401",
  checkCronSecret(mockReq("short"), CRON_ENV)?.status === 401);

// 7. header correct -> passes through
check("TC-15 header correct -> null (authorized)", checkCronSecret(mockReq(REAL_SECRET), CRON_ENV) === null);

// 8. 401 body shape unchanged
check("TC-15 401 body is 'unauthorized'",
  (await checkCronSecret(mockReq("wrong"), CRON_ENV)!.json()).error === "unauthorized");

// 9. the Strava secret is a SEPARATE blast radius from the shared CRON_SECRET.
Deno.env.set("CRON_SECRET", "the-vitals-secret");
check("TC-15 the vitals CRON_SECRET does NOT authorize strava-import",
  checkCronSecret(mockReq("the-vitals-secret"), CRON_ENV)?.status === 401);
check("TC-15 default env var still works for the vitals callers",
  checkCronSecret(mockReq("the-vitals-secret")) === null);

// restore prior env state
if (saved === undefined) Deno.env.delete(CRON_ENV); else Deno.env.set(CRON_ENV, saved);
if (savedShared === undefined) Deno.env.delete("CRON_SECRET"); else Deno.env.set("CRON_SECRET", savedShared);

// ---------------------------------------------------------------------------
// runImport — the orchestration itself.
//
// Everything above this line is a pure function. runImport is not, and until
// TC-16 it had no test at all: 600-odd lines carrying six of the nine
// acceptance criteria, exercised for the first time only against Scott's real
// Strava account and his real sessions table.
//
// It takes injectable `supa`, `now` and `budget` because it was designed to be
// driven this way. The two fakes below are the whole harness:
//
//   makeDb()     — a Supabase client implementing exactly the surface
//                  importer.ts uses (.from().select()/.update()/.delete() with
//                  chained filters, and .rpc()), backed by a tiny in-memory
//                  sessions table, recording every call in order.
//   installStrava() — globalThis.fetch, so the REAL client.ts runs: its URL
//                  building, its rate-limit header parsing and its error
//                  classes are under test too, and no network is touched.
//
// Call ORDER is recorded, not just call counts, because two of the defects
// these tests exist to pin (the cursor written before the rows, the watermark
// moved past unwritten activities) are ordering bugs that any count-based
// assertion passes straight through.
// ---------------------------------------------------------------------------
console.log("\nTC-16..25 runImport");

// Sentry must stay a no-op: captureFunctionError with a DSN set would try to
// reach the network from inside a test that has no permission to.
const savedDsn = Deno.env.get("SENTRY_DSN");
Deno.env.delete("SENTRY_DSN");

const USER = "11111111-2222-3333-4444-555555555555";
const epochOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
const NOW_MS = Date.parse("2026-08-28T00:00:00Z");

type FakeRow = Record<string, unknown>;
type LoggedCall = { table: string; op: string; cols?: string; payload?: unknown };

type SessionRow = {
  id: number;
  strava_activity_id: number | null;
  date_iso: string | null;
  type: string | null;
  distance_m: number | null;
  duration: string | null;
  source: string;
  /** strava_session_links.origin for a linked row (migration 012); absent when unlinked. */
  origin?: "inserted" | "adopted";
};

type DbOpts = {
  sync?: FakeRow | null;
  tokens?: FakeRow | null;
  sessions?: SessionRow[];
  /** Return an error object to make this write fail; undefined to let it through. */
  rpcFails?: (name: string, args: FakeRow) => { code: string } | undefined;
};

function makeDb(opts: DbOpts) {
  const log: LoggedCall[] = [];
  const syncPatches: FakeRow[] = [];
  const rpcCalls: { name: string; args: FakeRow }[] = [];
  const state = {
    sync: opts.sync === undefined ? null : opts.sync ? { ...opts.sync } : null,
    tokens: opts.tokens === undefined ? null : opts.tokens ? { ...opts.tokens } : null,
    sessions: (opts.sessions ?? []).map((s) => ({ ...s })),
  };
  let nextId = 900;

  const settle = (rec: LoggedCall, filters: [string, unknown[]][]) => {
    if (rec.table === "strava_sync_state") {
      if (rec.op === "select") return { data: state.sync, error: null };
      if (rec.op === "update") {
        const patch = rec.payload as FakeRow;
        syncPatches.push(patch);
        if (state.sync) Object.assign(state.sync, patch);
        return { data: null, error: null };
      }
    }
    if (rec.table === "strava_tokens") {
      if (rec.op === "select") return { data: state.tokens, error: null };
      if (rec.op === "delete") {
        state.tokens = null;
        return { data: null, error: null };
      }
      if (rec.op === "update") {
        // The compare-and-swap: only the worker that presented the stored
        // refresh token may write the rotation.
        const cas = filters.find((f) => f[0] === "eq" && f[1][0] === "refresh_token");
        const expected = cas ? cas[1][1] : undefined;
        if (!state.tokens || state.tokens.refresh_token !== expected) {
          return { data: [], error: null };
        }
        Object.assign(state.tokens, rec.payload as FakeRow);
        return { data: [{ user_id: USER }], error: null };
      }
    }
    if (rec.table === "sessions" && rec.op === "select") {
      // Two different reads, told apart the same way importer.ts asks for them.
      if (String(rec.cols).includes("date_iso")) {
        return {
          data: state.sessions
            .filter((s) => s.strava_activity_id == null && s.distance_m != null)
            .map((s) => ({ id: s.id, date_iso: s.date_iso, type: s.type, distance_m: s.distance_m })),
          error: null,
        };
      }
      const wanted = filters.find((f) => f[0] === "in")?.[1][1] as number[] | undefined;
      return {
        data: state.sessions
          .filter((s) => s.strava_activity_id != null && (wanted ?? []).includes(s.strava_activity_id))
          .map((s) => ({ id: s.id, strava_activity_id: s.strava_activity_id })),
        error: null,
      };
    }
    return { data: null, error: null };
  };

  const builder = (table: string, op: string, payload?: unknown, cols?: string) => {
    const rec: LoggedCall = { table, op, payload, cols };
    log.push(rec);
    const filters: [string, unknown[]][] = [];
    // deno-lint-ignore no-explicit-any
    const self: any = {
      select: (c?: string) => {
        rec.cols = c;
        return self;
      },
      maybeSingle: () => Promise.resolve(settle(rec, filters)),
      single: () => Promise.resolve(settle(rec, filters)),
      // deno-lint-ignore no-explicit-any
      then: (ok: any, bad: any) => Promise.resolve(settle(rec, filters)).then(ok, bad),
    };
    for (const m of ["eq", "in", "is", "gte", "lte", "not", "neq", "order", "limit"]) {
      self[m] = (...args: unknown[]) => {
        filters.push([m, args]);
        return self;
      };
    }
    return self;
  };

  const rpc = (name: string, args: FakeRow) => {
    log.push({ table: "rpc", op: name, payload: args });
    rpcCalls.push({ name, args });
    const failure = opts.rpcFails?.(name, args);
    if (failure) return Promise.resolve({ data: null, error: failure });

    if (name === "upsert_strava_session") {
      const aid = Number(args.p_activity_id);
      const existing = state.sessions.find((s) => s.strava_activity_id === aid);
      if (existing) {
        // Models migration 012's update branch, origin guard included: duration
        // and distance_m are refreshed only on rows whose link origin is
        // 'inserted' — never on an adopted row, whatever its source.
        if (existing.origin === "inserted") {
          existing.duration = args.p_duration as string;
          existing.distance_m = args.p_distance_m as number;
        }
        return Promise.resolve({ data: [{ session_id: existing.id, action: "updated" }], error: null });
      }
      const row: SessionRow = {
        id: nextId++,
        strava_activity_id: aid,
        date_iso: null,
        type: args.p_type as string,
        distance_m: args.p_distance_m as number,
        duration: args.p_duration as string,
        source: "strava",
        origin: "inserted",
      };
      state.sessions.push(row);
      return Promise.resolve({ data: [{ session_id: row.id, action: "inserted" }], error: null });
    }
    if (name === "adopt_strava_session") {
      const row = state.sessions.find((s) => s.id === Number(args.p_session_id));
      if (!row || row.strava_activity_id != null) {
        return Promise.resolve({ data: [{ session_id: args.p_session_id, action: "adopt_lost_race" }], error: null });
      }
      row.strava_activity_id = Number(args.p_activity_id);
      row.origin = "adopted";
      return Promise.resolve({ data: [{ session_id: row.id, action: "adopted" }], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };

  const supa = {
    from: (table: string) => ({
      select: (cols?: string) => builder(table, "select", undefined, cols),
      update: (payload: FakeRow) => builder(table, "update", payload),
      delete: () => builder(table, "delete"),
      insert: (payload: unknown) => builder(table, "insert", payload),
    }),
    rpc,
  };

  return {
    supa,
    log,
    rpcCalls,
    syncPatches,
    state,
    writes: () => log.filter((c) => c.op === "update" || c.op === "delete" || c.op === "insert"),
    lastSyncPatch: () => syncPatches[syncPatches.length - 1],
    indexOf: (pred: (c: LoggedCall) => boolean) => log.findIndex(pred),
    lastIndexOf: (pred: (c: LoggedCall) => boolean) => {
      for (let i = log.length - 1; i >= 0; i--) if (pred(log[i])) return i;
      return -1;
    },
  };
}

// --- the fake Strava HTTP layer -------------------------------------------
// globalThis.fetch, so the real client.ts runs against it.

type StravaStub = {
  activities: StravaActivity[];
  detail?: Record<number, StravaActivity | number>;
  /** 'ok' | 'invalid_grant' | number (an HTTP status) */
  token?: "ok" | "invalid_grant" | number;
  /** Per list call, a status to return instead of 200. */
  listStatus?: (call: number) => number | undefined;
  usage?: string;
  limit?: string;
  /** Read-usage header on detail responses only, when it must differ from the list's. */
  detailUsage?: string;
};

function installStrava(stub: StravaStub) {
  const real = globalThis.fetch;
  const listCalls: { after: number | null; before: number | null; page: number }[] = [];
  const detailCalls: number[] = [];
  const epoch = (a: StravaActivity) => Math.floor(Date.parse(String(a.start_date)) / 1000);
  const headers = {
    "content-type": "application/json",
    "x-readratelimit-limit": stub.limit ?? "100,1000",
    "x-readratelimit-usage": stub.usage ?? "1,1",
  };

  globalThis.fetch = ((input: string | URL | Request, _init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);

    if (url.href.startsWith("https://www.strava.com/oauth/token")) {
      const mode = stub.token ?? "ok";
      if (mode === "invalid_grant") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers }),
        );
      }
      if (typeof mode === "number") {
        return Promise.resolve(new Response("{}", { status: mode, headers }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_at: Math.floor(NOW_MS / 1000) + 21600,
            athlete_id: 7,
          }),
          { status: 200, headers },
        ),
      );
    }

    if (url.pathname === "/api/v3/athlete/activities") {
      const after = url.searchParams.has("after") ? Number(url.searchParams.get("after")) : null;
      const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : null;
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      listCalls.push({ after, before, page });

      const status = stub.listStatus?.(listCalls.length);
      if (status) return Promise.resolve(new Response("[]", { status, headers }));

      // Strava orders /athlete/activities newest-first.
      let pool = stub.activities.slice().sort((x, y) => epoch(y) - epoch(x));
      if (after != null) pool = pool.filter((a) => epoch(a) > after);
      if (before != null) pool = pool.filter((a) => epoch(a) < before);
      const slice = pool.slice((page - 1) * perPage, page * perPage);
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200, headers }));
    }

    const m = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      detailCalls.push(id);
      const d = stub.detail?.[id];
      const dh = stub.detailUsage ? { ...headers, "x-readratelimit-usage": stub.detailUsage } : headers;
      if (typeof d === "number") return Promise.resolve(new Response("{}", { status: d, headers: dh }));
      if (!d) return Promise.resolve(new Response("{}", { status: 404, headers: dh }));
      return Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: dh }));
    }

    return Promise.resolve(new Response("{}", { status: 404, headers }));
  }) as typeof fetch;

  return {
    listCalls,
    detailCalls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

// --- fixtures --------------------------------------------------------------

const freshTokens = {
  athlete_id: 7,
  access_token: "live-access",
  refresh_token: "live-refresh",
  expires_at: new Date(NOW_MS + 6 * 3600_000).toISOString(),
  scope: "activity:read_all",
};

const syncRow = (over: FakeRow = {}): FakeRow => ({
  user_id: USER,
  connected: true,
  backfill_from: BACKFILL_FROM,
  backfill_complete: true,
  backfill_cursor_before: null,
  incremental_after: epochOf("2026-08-01T00:00:00Z"),
  imported_total: 0,
  adopted_total: 0,
  skipped_total: 0,
  failed_total: 0,
  ambiguous_activity_ids: [],
  rate_limit_resets_at: null,
  ...over,
});

/** A list-payload summary: everything a SummaryActivity really carries. */
const summary = (id: number, localIso: string, over: Partial<StravaActivity> = {}): StravaActivity => ({
  id,
  name: `Row ${id}`,
  sport_type: "Rowing",
  start_date: `${localIso.slice(0, 19)}Z`,
  start_date_local: localIso,
  distance: 6000.4,
  moving_time: 1500,
  ...over,
});

/** The same activity as /activities/:id returns it — with power and HR. */
const detailed = (s: StravaActivity, over: Partial<StravaActivity> = {}): StravaActivity => ({
  ...s,
  average_watts: 149.6,
  has_device_watts: true,
  average_heartrate: 130.4,
  has_heartrate: true,
  ...over,
});

/**
 * A summary that already carries power, HR and a (non-Garmin) device name, so
 * no detail fetch is needed. Without the device name it WOULD need one (#629):
 * device_name is documented on DetailedActivity only.
 */
const fullSummary = (id: number, localIso: string, over: Partial<StravaActivity> = {}): StravaActivity =>
  detailed(summary(id, localIso), { device_name: "Concept2 PM5", ...over });

// deno-lint-ignore no-explicit-any
const run = (db: any, over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  runImport(
    {
      supa: db.supa,
      clientId: "cid",
      clientSecret: "csecret",
      backfillFrom: BACKFILL_FROM,
      now: () => NOW_MS,
      ...over,
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    { userId: USER, mode: "cron", dryRun: false, ...opts } as any,
  );

// ---------------------------------------------------------------------------
// TC-16 — a dry run writes NOTHING
// ---------------------------------------------------------------------------
{
  const a1 = summary(1001, "2026-08-21T20:30:45");
  const a2 = summary(1002, "2026-08-23T06:10:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [a1, a2],
    detail: { 1001: detailed(a1), 1002: detailed(a2) },
  });
  const r = await run(db, {}, { dryRun: true });
  net.restore();

  check("TC-16 dry run sees both activities", r.imported === 2, r);
  check("TC-16 dry run makes ZERO writes of any kind", db.writes().length === 0, db.writes());
  check("TC-16 dry run calls no RPC", db.rpcCalls.length === 0, db.rpcCalls);
  check("TC-16 dry run writes no sync state", db.syncPatches.length === 0, db.syncPatches);
  check(
    "TC-16 dry run does not move the incremental cursor",
    db.state.sync.incremental_after === epochOf("2026-08-01T00:00:00Z"),
    db.state.sync.incremental_after,
  );
  check("TC-16 dry run still fetched detail (it is a read)", net.detailCalls.length === 2, net.detailCalls);
  check("TC-16 dry run creates no session rows", db.state.sessions.length === 0, db.state.sessions);
}

// ---------------------------------------------------------------------------
// TC-17 — nothing to do
// ---------------------------------------------------------------------------
{
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [] });
  const r = await run(db);
  net.restore();

  check("TC-17 empty account -> noop", r.status === "noop", r);
  check("TC-17 empty account writes no rows", db.rpcCalls.length === 0, db.rpcCalls);
  check(
    "TC-17 empty account does not move the cursor",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-01T00:00:00Z"),
    db.lastSyncPatch(),
  );
  check("TC-17 no detail fetches", net.detailCalls.length === 0, net.detailCalls);
}
{
  // Ineligible activities are the opposite case, and the invariant is the
  // other way round: the watermark MUST advance over them or a week of
  // WeightTraining is re-listed for ever.
  const w = summary(1201, "2026-08-20T07:00:00", { sport_type: "WeightTraining" });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [w] });
  const r = await run(db);
  net.restore();

  check("TC-17 ineligible-only -> noop", r.status === "noop" && r.imported === 0, r);
  check("TC-17 ineligible-only costs no detail fetch", net.detailCalls.length === 0, net.detailCalls);
  check(
    "TC-17 watermark still advances over ineligible activities",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-20T07:00:00Z"),
    db.lastSyncPatch().incremental_after,
  );
}

// ---------------------------------------------------------------------------
// TC-18 — one failing activity does not take the others down (criterion 7)
// ---------------------------------------------------------------------------
{
  const acts = [
    fullSummary(1301, "2026-08-20T06:00:00"),
    fullSummary(1302, "2026-08-21T06:00:00"),
    fullSummary(1303, "2026-08-22T06:00:00"),
  ];
  const db = makeDb({
    sync: syncRow(),
    tokens: { ...freshTokens },
    rpcFails: (name, args) =>
      name === "upsert_strava_session" && Number(args.p_activity_id) === 1302
        ? { code: "23505" }
        : undefined,
  });
  const net = installStrava({ activities: acts });
  const r = await run(db);
  net.restore();

  check("TC-18 the other two are written", r.imported === 2, r);
  check("TC-18 failed count is exactly 1", r.failed === 1, r);
  check("TC-18 run ends partial", r.status === "partial", r);
  check("TC-18 partial is not ok", r.ok === false, r);
  check("TC-18 error code is db_write_failed", r.errorCode === "db_write_failed", r);
  check(
    "TC-18 the failure is reported per activity",
    r.decisions.filter((d) => d.action === "failed").map((d) => d.activityId).join() === "1302",
    r.decisions,
  );
  check("TC-18 two rows exist", db.state.sessions.length === 2, db.state.sessions);
}

// ---------------------------------------------------------------------------
// TC-19 — a dry run must never delete the tokens (D4)
// ---------------------------------------------------------------------------
{
  const stale = { ...freshTokens, expires_at: new Date(NOW_MS - 60_000).toISOString() };
  const db = makeDb({ sync: syncRow(), tokens: stale });
  const net = installStrava({ activities: [], token: "invalid_grant" });
  const r = await run(db, {}, { dryRun: true });
  net.restore();

  check("TC-19 dry run against a revoked token reports auth_failed", r.status === "auth_failed", r);
  check("TC-19 dry run does NOT delete the token row", db.state.tokens !== null, db.state.tokens);
  check(
    "TC-19 dry run issues no delete at all",
    db.log.filter((c) => c.op === "delete").length === 0,
    db.log,
  );
  check("TC-19 dry run does not disconnect in sync state", db.syncPatches.length === 0, db.syncPatches);
}
{
  // The real run is the control: a genuinely revoked connection still gets
  // torn down, so TC-19 is proving dryRun suppression, not a broken path.
  const stale = { ...freshTokens, expires_at: new Date(NOW_MS - 60_000).toISOString() };
  const db = makeDb({ sync: syncRow(), tokens: stale });
  const net = installStrava({ activities: [], token: "invalid_grant" });
  const r = await run(db);
  net.restore();

  check("TC-19 a REAL run does delete a revoked token row", db.state.tokens === null, db.state.tokens);
  check("TC-19 a REAL run marks the sync state disconnected",
    r.status === "auth_failed" && db.lastSyncPatch().connected === false, db.lastSyncPatch());
}

// ---------------------------------------------------------------------------
// TC-20 — re-import of a linked activity is one upsert, never a second row
//         (criterion 2 — the idempotence guarantee)
// ---------------------------------------------------------------------------
{
  const first = fullSummary(1401, "2026-08-20T06:00:00", { name: "Morning Row" });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net1 = installStrava({ activities: [first] });
  const r1 = await run(db);
  net1.restore();
  check("TC-20 first run inserts", r1.imported === 1 && db.state.sessions.length === 1, r1);

  // Second run: renamed activity, different power, and the watermark has moved
  // past it — so re-list it explicitly, which is what a backfill overlap or a
  // manual Sync does.
  const renamed = fullSummary(1401, "2026-08-20T06:00:00", {
    name: "Threshold pieces",
    average_watts: 201.4,
  });
  db.syncPatches.length = 0;
  db.rpcCalls.length = 0;
  db.state.sync.incremental_after = epochOf("2026-08-01T00:00:00Z");
  const net2 = installStrava({ activities: [renamed] });
  const r2 = await run(db);
  net2.restore();

  check("TC-20 second run makes exactly one RPC call", db.rpcCalls.length === 1, db.rpcCalls);
  check("TC-20 and it is the upsert, not an adopt", db.rpcCalls[0].name === "upsert_strava_session", db.rpcCalls);
  check("TC-20 counted as an update, not an import", r2.updated === 1 && r2.imported === 0, r2);
  check("TC-20 still exactly one session row", db.state.sessions.length === 1, db.state.sessions);
  check("TC-20 the changed label is still sent (the RPC decides what to keep)",
    String(db.rpcCalls[0].args.p_label).startsWith("Threshold pieces"), db.rpcCalls[0].args);
}

// ---------------------------------------------------------------------------
// TC-21 — an adopted row is not duplicated on the next run (criterion 3)
// ---------------------------------------------------------------------------
{
  const a = fullSummary(1501, "2026-08-20T06:00:00");
  const legacy: SessionRow = {
    id: 42,
    strava_activity_id: null,
    date_iso: "2026-08-20",
    type: "Z2 Aerobic",
    distance_m: 6002,
    duration: "25min",
    source: "portal",
  };
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens }, sessions: [legacy] });
  const net1 = installStrava({ activities: [a] });
  const r1 = await run(db);
  net1.restore();

  check("TC-21 run 1 adopts rather than inserts", r1.adopted === 1 && r1.imported === 0, r1);
  check("TC-21 run 1 leaves exactly one session row", db.state.sessions.length === 1, db.state.sessions);
  check("TC-21 run 1 links the legacy row", db.state.sessions[0].id === 42, db.state.sessions);

  db.rpcCalls.length = 0;
  db.state.sync.incremental_after = epochOf("2026-08-01T00:00:00Z");
  const net2 = installStrava({ activities: [a] });
  const r2 = await run(db);
  net2.restore();

  check("TC-21 run 2 does not duplicate", db.state.sessions.length === 1, db.state.sessions);
  check("TC-21 run 2 is an update, not an insert or a second adopt",
    r2.updated === 1 && r2.imported === 0 && r2.adopted === 0, r2);
  check("TC-21 run 2 makes exactly one RPC call", db.rpcCalls.length === 1, db.rpcCalls);
  check("TC-21 the adopted row keeps the duration Scott filed",
    db.state.sessions[0].duration === "25min", db.state.sessions[0]);
}

// ---------------------------------------------------------------------------
// TC-22 — the detail fetch, and what happens when the budget runs out (D1)
// ---------------------------------------------------------------------------
{
  // The whole point of D1: a summary carries no watts, so without a detail
  // fetch avg_watts is null and sessionLoad() scores the session 0.
  const s = summary(1601, "2026-08-21T20:30:45");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 1601: detailed(s) } });
  const r = await run(db);
  net.restore();

  check("TC-22 a power-less summary triggers a detail fetch", net.detailCalls.join() === "1601", net.detailCalls);
  check("TC-22 the imported row carries device watts", db.rpcCalls[0].args.p_avg_watts === 150, db.rpcCalls[0].args);
  check("TC-22 and heart rate", db.rpcCalls[0].args.p_avg_hr === 130, db.rpcCalls[0].args);
  check("TC-22 nothing deferred", r.deferred === 0 && r.status === "ok", r);
}
{
  // A summary that already carries both must NOT spend a read.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [fullSummary(1602, "2026-08-21T20:30:45")] });
  await run(db);
  net.restore();
  check("TC-22 a complete summary costs no detail fetch", net.detailCalls.length === 0, net.detailCalls);
}
{
  // An ineligible-by-summary activity must not have a read spent on it either.
  const short = summary(1603, "2026-08-21T20:30:45", { moving_time: 40, distance: 90 });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [short], detail: { 1603: detailed(short) } });
  await run(db);
  net.restore();
  check("TC-22 a fragment costs no detail fetch", net.detailCalls.length === 0, net.detailCalls);
}
{
  // Budget exhausted mid-chunk: the activities whose detail was never fetched
  // are DEFERRED, not written with a null avg_watts, and the watermark is held
  // below them so the next run re-lists them.
  const acts = [
    summary(1701, "2026-08-20T06:00:00"),
    summary(1702, "2026-08-21T06:00:00"),
    summary(1703, "2026-08-22T06:00:00"),
  ];
  const detail: Record<number, StravaActivity> = {};
  for (const a of acts) detail[a.id] = detailed(a);
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: acts, detail });
  // 1 list call + 2 detail fetches, then the budget is spent.
  const r = await run(db, { budget: { maxCalls: 3, maxElapsedMs: 60_000 } });
  net.restore();

  const oldest = epochOf("2026-08-20T06:00:00Z");
  check("TC-22 budget stop: two written, one deferred",
    r.imported === 2 && r.deferred === 1, r);
  check("TC-22 budget stop: the deferred activity is NOT written",
    db.rpcCalls.every((c) => Number(c.args.p_activity_id) !== 1701), db.rpcCalls);
  check("TC-22 budget stop: no row has a null avg_watts",
    db.rpcCalls.every((c) => typeof c.args.p_avg_watts === "number"), db.rpcCalls);
  check("TC-22 budget stop: the deferral is reported",
    r.decisions.some((d) => d.activityId === 1701 && String(d.detail).startsWith("deferred:")),
    r.decisions);
  check("TC-22 budget stop: stopReason recorded", r.stopReason === "calls", r);
  check("TC-22 budget stop: the watermark is held BELOW the deferred activity",
    db.lastSyncPatch().incremental_after === oldest - 1, db.lastSyncPatch().incremental_after);
  check("TC-22 budget stop: a deferral is not a skip",
    r.skipped === 0 && r.failed === 0, r);
}
{
  // A deferral found by the BACKFILL pass must RAISE backfill_cursor_before
  // ABOVE the activity. The backfill walks backwards with `before=cursor`, and
  // Strava's `before` is exclusive, so the next run lists epoch < cursor: the
  // only way to re-list a deferred activity at epoch e is a cursor > e.
  //
  // Sentry Seer flagged the Math.max on PR #324 as a CRITICAL bug and proposed
  // Math.min. That would pin the cursor at the oldest-seen epoch, which is
  // BELOW the deferred activity, so `before=cursor` would never list it again
  // — causing exactly the permanent skip the report warned about. This test
  // fails under Math.min, which is why it exists.
  const a = summary(1901, "2026-07-10T06:00:00");
  const e = epochOf("2026-07-10T06:00:00Z");
  const db = makeDb({
    // incremental_after above the activity puts it on the backfill side of the
    // `e > startingIncrementalAfter` test in holdCursorFor.
    sync: syncRow({
      backfill_complete: false,
      backfill_cursor_before: null,
      incremental_after: e + 10_000,
    }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({ activities: [a], detail: { 1901: 500 } });
  const r = await run(db);
  net.restore();

  check("TC-22 backfill deferral: deferred, not written",
    r.deferred === 1 && r.imported === 0, r);
  check("TC-22 BACKFILL DEFERRAL: CURSOR RAISED ABOVE THE ACTIVITY (Math.min fails this)",
    db.lastSyncPatch().backfill_cursor_before === e + 1,
    db.lastSyncPatch().backfill_cursor_before);
  check("TC-22 backfill deferral: a cursor > e re-lists it under exclusive `before`",
    (db.lastSyncPatch().backfill_cursor_before as number) > e, db.lastSyncPatch());
  check("TC-22 backfill deferral: backfill is not marked complete",
    db.lastSyncPatch().backfill_complete === false, db.lastSyncPatch());
}
{
  // Same guarantee when the detail fetch itself fails.
  const a = summary(1801, "2026-08-22T06:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [a], detail: { 1801: 500 } });
  const r = await run(db);
  net.restore();

  check("TC-22 detail 500 -> nothing written", db.rpcCalls.length === 0 && r.imported === 0, db.rpcCalls);
  check("TC-22 detail 500 -> deferred", r.deferred === 1, r);
  check("TC-22 detail 500 -> watermark held below it",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-22T06:00:00Z") - 1,
    db.lastSyncPatch().incremental_after);
}

// ---------------------------------------------------------------------------
// TC-23 — the backfill cursor never moves ahead of the rows it describes (D2)
// ---------------------------------------------------------------------------
{
  const acts = [
    fullSummary(1901, "2026-06-20T06:00:00"),
    fullSummary(1902, "2026-06-21T06:00:00"),
    fullSummary(1903, "2026-06-22T06:00:00"),
    // Older than STRAVA_BACKFILL_FROM: this is what terminates the walk.
    fullSummary(1904, "2025-12-20T06:00:00"),
  ];
  const db = makeDb({
    sync: syncRow({
      backfill_complete: false,
      backfill_cursor_before: null,
      incremental_after: epochOf("2026-08-25T00:00:00Z"),
    }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({ activities: acts });
  const r = await run(db);
  net.restore();

  const firstSyncWrite = db.indexOf((c: LoggedCall) => c.table === "strava_sync_state" && c.op === "update");
  const lastRowWrite = db.lastIndexOf((c: LoggedCall) => c.table === "rpc");

  check("TC-23 the backfill imported the three in-window activities", r.imported === 3, r);
  check("TC-23 sync state is written EXACTLY once per run",
    db.syncPatches.length === 1, db.syncPatches);
  check("TC-23 the cursor is written AFTER every row it describes",
    firstSyncWrite > lastRowWrite && lastRowWrite >= 0, { firstSyncWrite, lastRowWrite });
  check("TC-23 no cursor-only write escapes mid-walk",
    db.syncPatches.every((p: FakeRow) => "last_run_at" in p), db.syncPatches);
  check("TC-23 the backfill is marked complete once the floor is reached",
    db.lastSyncPatch().backfill_complete === true, db.lastSyncPatch());
}
{
  // The zero-eligible path must persist the cursor too, or a chunk that walked
  // a page of nothing but WeightTraining throws that walk away every run.
  const db = makeDb({
    sync: syncRow({
      backfill_complete: false,
      backfill_cursor_before: null,
      incremental_after: epochOf("2026-08-25T00:00:00Z"),
    }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({
    activities: [summary(1951, "2026-06-20T06:00:00", { sport_type: "WeightTraining" })],
  });
  await run(db);
  net.restore();
  check("TC-23 zero-eligible run still persists the backfill cursor",
    typeof db.lastSyncPatch().backfill_cursor_before === "number", db.lastSyncPatch());
}

// ---------------------------------------------------------------------------
// TC-24 — multi-page incremental skips nothing (D3)
// ---------------------------------------------------------------------------
{
  // 150 activities forces a second page at PER_PAGE = 100. They are Runs so the
  // pass costs no detail fetches; every one still produces a decision, which is
  // how we prove all 150 were listed.
  const many: StravaActivity[] = [];
  for (let i = 0; i < 150; i++) {
    const day = new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + i * 3600_000).toISOString().slice(0, 19);
    many.push(summary(2000 + i, day, { sport_type: "Run" }));
  }
  const db = makeDb({
    sync: syncRow({ incremental_after: epochOf("2026-07-31T00:00:00Z") }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({ activities: many });
  const r = await run(db);
  net.restore();

  const seenIds = new Set(r.decisions.map((d) => d.activityId));
  const missing = many.filter((a) => !seenIds.has(a.id)).map((a) => a.id);

  check("TC-24 more than one page was requested", net.listCalls.length >= 2, net.listCalls);
  check("TC-24 `after` is held FIXED across pages",
    new Set(net.listCalls.map((c) => c.after)).size === 1, net.listCalls);
  check("TC-24 only `page` advances",
    net.listCalls.map((c) => c.page).join() === net.listCalls.map((_c, i) => i + 1).join(),
    net.listCalls);
  check("TC-24 every one of the 150 activities was seen", missing.length === 0, missing);
  check("TC-24 the watermark lands on the newest, not on page 1's oldest",
    db.lastSyncPatch().incremental_after === Math.max(...many.map((a) => epochOf(String(a.start_date)))),
    db.lastSyncPatch().incremental_after);
}

// ---------------------------------------------------------------------------
// TC-25 — status precedence: rate_limited > partial > error > noop > ok
// ---------------------------------------------------------------------------
{
  // rate_limited outranks a run that wrote rows successfully.
  const db = makeDb({
    sync: syncRow({ backfill_complete: false, backfill_cursor_before: null }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({
    activities: [fullSummary(2201, "2026-08-20T06:00:00")],
    // call 1 is the incremental list; call 2 is the first backfill page.
    listStatus: (n) => (n === 2 ? 429 : undefined),
  });
  const r = await run(db);
  net.restore();
  check("TC-25 rate_limited outranks a successful write",
    r.status === "rate_limited" && r.imported === 1, r);
  check("TC-25 rate_limited sets the error code", r.errorCode === "rate_limited", r);
  check("TC-25 rate_limited arms the quarter-hour hold",
    typeof db.lastSyncPatch().rate_limit_resets_at === "string", db.lastSyncPatch());
}
{
  // A run held off by a previous 429 returns before touching anything.
  const db = makeDb({
    sync: syncRow({ rate_limit_resets_at: new Date(NOW_MS + 300_000).toISOString() }),
    tokens: { ...freshTokens },
  });
  const net = installStrava({ activities: [fullSummary(2202, "2026-08-20T06:00:00")] });
  const r = await run(db);
  net.restore();
  check("TC-25 an armed rate-limit hold short-circuits the run",
    r.status === "rate_limited" && net.listCalls.length === 0, { r, listCalls: net.listCalls });
}
{
  // Every write fails: error, not partial.
  const db = makeDb({
    sync: syncRow(),
    tokens: { ...freshTokens },
    rpcFails: () => ({ code: "42501" }),
  });
  const net = installStrava({ activities: [fullSummary(2203, "2026-08-20T06:00:00")] });
  const r = await run(db);
  net.restore();
  check("TC-25 all writes failing -> error, not partial", r.status === "error" && r.failed === 1, r);
}
{
  // Eligible but nothing written and nothing failed -> noop. Two candidate
  // rows inside tolerance is ambiguous, and ambiguity writes nothing.
  const a = fullSummary(2204, "2026-08-20T06:00:00");
  const twin = (id: number): SessionRow => ({
    id,
    strava_activity_id: null,
    date_iso: "2026-08-20",
    type: "erg",
    distance_m: 6000,
    duration: "25:00",
    source: "portal",
  });
  const db = makeDb({
    sync: syncRow(),
    tokens: { ...freshTokens },
    sessions: [twin(51), twin(52)],
  });
  const net = installStrava({ activities: [a] });
  const r = await run(db);
  net.restore();
  check("TC-25 ambiguous-only run -> noop", r.status === "noop", r);
  check("TC-25 ambiguity writes nothing", db.rpcCalls.length === 0, db.rpcCalls);
  check("TC-25 ambiguity is recorded for a human", r.ambiguousActivityIds.join() === "2204", r);
  check("TC-25 noop is still ok", r.ok === true, r);
}
{
  // A disconnected user is a noop before any network call at all.
  const db = makeDb({ sync: syncRow({ connected: false }), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [fullSummary(2205, "2026-08-20T06:00:00")] });
  const r = await run(db);
  net.restore();
  check("TC-25 disconnected -> noop with no calls",
    r.status === "noop" && net.listCalls.length === 0 && db.writes().length === 0, r);
}
{
  // And the plain happy path is 'ok'.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [fullSummary(2206, "2026-08-20T06:00:00")] });
  const r = await run(db);
  net.restore();
  check("TC-25 a clean run -> ok", r.status === "ok" && r.ok === true, r);
  check("TC-25 counters are carried forward, not reset",
    db.lastSyncPatch().imported_total === 1, db.lastSyncPatch());
}

// ---------------------------------------------------------------------------
// TC-26 — the approved eligibility list (#629, owner decision on #628)
// ---------------------------------------------------------------------------
console.log("\nTC-26 eligibility: rowing and every pedalled ride");

const EXPECTED_ELIGIBLE: Record<string, "erg" | "cycling"> = {
  Rowing: "erg",
  VirtualRow: "erg",
  Ride: "cycling",
  VirtualRide: "cycling",
  GravelRide: "cycling",
  MountainBikeRide: "cycling",
  EBikeRide: "cycling",
  EMountainBikeRide: "cycling",
};
check("TC-26 exactly the eight approved types are eligible",
  [...ELIGIBLE_SPORT_TYPES].sort().join() === Object.keys(EXPECTED_ELIGIBLE).sort().join(),
  ELIGIBLE_SPORT_TYPES);
for (const [sport, sessionType] of Object.entries(EXPECTED_ELIGIBLE)) {
  const a = act({ sport_type: sport });
  check(`TC-26 ${sport} eligible`, isEligible(a, BACKFILL_FROM).eligible === true, isEligible(a, BACKFILL_FROM));
  check(`TC-26 ${sport} -> ${sessionType}`, mapActivityToSession(a).type === sessionType,
    mapActivityToSession(a).type);
}
for (
  const sport of [
    "Handcycle", "Velomobile", "Walk", "Run", "Hike", "Workout", "WeightTraining", "Yoga", "NordicSki",
    "ride", "Ride ", " Ride", "RIDE", "rowing", "virtualrow", "EBikeride",
  ]
) {
  const v = isEligible(act({ sport_type: sport }), BACKFILL_FROM);
  check(`TC-26 ${JSON.stringify(sport)} rejected as sport_type`,
    v.eligible === false && v.reason === "sport_type", v);
}

// ---------------------------------------------------------------------------
// TC-27 — detail fetch gate for the new types
// ---------------------------------------------------------------------------
console.log("\nTC-27 needsDetailFetch for rides");

const powerlessSummary = { average_watts: undefined, has_device_watts: undefined, device_watts: undefined,
  average_heartrate: undefined, has_heartrate: undefined };
check("TC-27 a Ride with no watts needs detail",
  needsDetailFetch(act({ sport_type: "Ride", ...powerlessSummary })) === true);
for (const sport of ["Walk", "Run", "WeightTraining"]) {
  check(`TC-27 ${sport} never needs detail`,
    needsDetailFetch(act({ sport_type: sport, ...powerlessSummary })) === false);
}

// ---------------------------------------------------------------------------
// TC-28 — a ride with no device power is WRITTEN, with null avg_watts
// ---------------------------------------------------------------------------
console.log("\nTC-28 rides without a power meter");
{
  const s = summary(2301, "2026-08-21T07:00:00", { sport_type: "Ride", distance: 30000, moving_time: 3600 });
  // Strava estimates power for a ride with no meter: device_watts false, and an
  // average_watts that must never reach the row.
  const d = detailed(s, { has_device_watts: false, device_watts: false, average_watts: 180.2,
    average_heartrate: 140.4, has_heartrate: true });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2301: d } });
  const r = await run(db);
  net.restore();
  const dec = r.decisions.find((x) => x.activityId === 2301);
  check("TC-28 the detail was fetched", net.detailCalls.join() === "2301", net.detailCalls);
  check("TC-28 decision is insert", dec?.action === "insert", dec);
  check("TC-28 not deferred", r.deferred === 0 && r.imported === 1, r);
  check("TC-28 avg_watts null (estimate discarded)", db.rpcCalls[0]?.args.p_avg_watts === null, db.rpcCalls[0]?.args);
  check("TC-28 avg_hr set", db.rpcCalls[0]?.args.p_avg_hr === 140, db.rpcCalls[0]?.args);
  check("TC-28 type cycling", db.rpcCalls[0]?.args.p_type === "cycling", db.rpcCalls[0]?.args);
}
{
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [fullSummary(2302, "2026-08-21T07:00:00", { sport_type: "EBikeRide" })] });
  await run(db);
  net.restore();
  check("TC-28 EBikeRide with device watts -> avg_watts populated",
    db.rpcCalls[0]?.args.p_avg_watts === 150 && db.rpcCalls[0]?.args.p_type === "cycling", db.rpcCalls[0]?.args);
}

// ---------------------------------------------------------------------------
// TC-29 — adoption distance tolerance on a ride
// ---------------------------------------------------------------------------
console.log("\nTC-29 adoption tolerance for cycling");
{
  const ride = act({ id: 2401, sport_type: "Ride", distance: 22870, start_date_local: "2026-08-21T07:00:00" });
  const near = chooseAdoptionCandidate(ride, [{ id: 2411, date_iso: "2026-08-21", type: "cycling", distance_m: 22900 }]);
  check("TC-29 22,870 m vs a 22,900 m cycling row -> adopt",
    near.decision === "adopt" && near.sessionId === 2411, near);
  const far = chooseAdoptionCandidate(ride, [{ id: 2412, date_iso: "2026-08-21", type: "cycling", distance_m: 23000 }]);
  check("TC-29 22,870 m vs a 23,000 m cycling row -> insert", far.decision === "insert", far);
}

// ---------------------------------------------------------------------------
// TC-30 — Garmin-recorded activities are skipped (Strava API Policy §4.4, #632)
// ---------------------------------------------------------------------------
console.log("\nTC-30 Garmin skip");

check("TC-30 'Garmin Edge 530' is Garmin", isGarminRecorded(act({ device_name: "Garmin Edge 530" })));
check("TC-30 case-insensitive", isGarminRecorded(act({ device_name: "GARMIN fenix 7" })));
for (const name of ["Concept2 PM5", "Zwift", null, undefined]) {
  check(`TC-30 ${JSON.stringify(name)} is not Garmin`, !isGarminRecorded(act({ device_name: name })));
  check(`TC-30 ${JSON.stringify(name)} stays eligible`,
    isEligible(act({ device_name: name }), BACKFILL_FROM).eligible === true);
}
{
  const missing = { ...rowing };
  delete missing.device_name;
  check("TC-30 device_name absent altogether is not Garmin",
    !isGarminRecorded(missing) && isEligible(missing, BACKFILL_FROM).eligible === true);
}
for (const sport of ["Rowing", "Ride", "VirtualRide"]) {
  const v = isEligible(act({ sport_type: sport, device_name: "Garmin Edge 530" }), BACKFILL_FROM);
  check(`TC-30 Garmin ${sport} skipped as garmin_attribution_pending`,
    v.eligible === false && v.reason === "garmin_attribution_pending", v);
}
check("TC-30 a Garmin summary needs no detail fetch, even without power",
  needsDetailFetch(act({ sport_type: "Ride", device_name: "Garmin Edge 530", ...powerlessSummary })) === false);
{
  // Garmin on the summary: skipped with a named reason, and no read spent.
  const g = summary(2501, "2026-08-21T07:00:00", { sport_type: "Ride", device_name: "Garmin Edge 530" });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [g], detail: { 2501: detailed(g) } });
  const r = await run(db);
  net.restore();
  const dec = r.decisions.find((x) => x.activityId === 2501);
  check("TC-30 summary Garmin -> skip garmin_attribution_pending",
    dec?.action === "skip" && dec?.detail === "garmin_attribution_pending", dec);
  check("TC-30 summary Garmin -> NO detail fetch", net.detailCalls.length === 0, net.detailCalls);
  check("TC-30 summary Garmin -> nothing written", db.rpcCalls.length === 0, db.rpcCalls);
  check("TC-30 the watermark still advances past a Garmin-skipped activity",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-21T07:00:00Z"), db.lastSyncPatch());
}
{
  // Garmin named only on the detail: still skipped, before any write.
  const s = summary(2502, "2026-08-21T07:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2502: detailed(s, { device_name: "Garmin Forerunner 965" }) } });
  const r = await run(db);
  net.restore();
  const dec = r.decisions.find((x) => x.activityId === 2502);
  check("TC-30 detail-only Garmin -> detail fetched once", net.detailCalls.join() === "2502", net.detailCalls);
  check("TC-30 detail-only Garmin -> skipped before any write",
    dec?.detail === "garmin_attribution_pending" && db.rpcCalls.length === 0, { dec, rpc: db.rpcCalls });
  check("TC-30 detail-only Garmin -> not deferred", r.deferred === 0, r);
}
{
  // A dry run shows the decision like any other skip.
  const g = summary(2503, "2026-08-21T07:00:00", { device_name: "Garmin Edge 1040" });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [g] });
  const r = await run(db, {}, { dryRun: true });
  net.restore();
  check("TC-30 dry run reports the Garmin skip",
    r.decisions.some((x) => x.activityId === 2503 && x.detail === "garmin_attribution_pending"), r.decisions);
}
{
  // Non-Garmin devices are imported normally.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const nullDevice = fullSummary(2506, "2026-08-23T07:00:00", { device_name: null });
  const net = installStrava({
    activities: [
      fullSummary(2504, "2026-08-21T07:00:00", { device_name: "Concept2 PM5" }),
      fullSummary(2505, "2026-08-22T07:00:00", { sport_type: "VirtualRide", device_name: "Zwift" }),
      nullDevice,
    ],
    // A null device name on the summary costs a detail fetch; the detail is null too.
    detail: { 2506: nullDevice },
  });
  const r = await run(db);
  net.restore();
  check("TC-30 Concept2 PM5, Zwift and null device are all imported", r.imported === 3, r);
}

// ---------------------------------------------------------------------------
// TC-31 — p_device_name reaches both RPCs (provenance)
// ---------------------------------------------------------------------------
console.log("\nTC-31 device name is passed to the RPCs");
{
  const legacy: SessionRow = {
    id: 77, strava_activity_id: null, date_iso: "2026-08-20", type: "erg", distance_m: 6000,
    duration: "25min", source: "portal",
  };
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens }, sessions: [legacy] });
  const net = installStrava({
    activities: [
      fullSummary(2601, "2026-08-20T06:00:00", { device_name: "Concept2 PM5" }),
      fullSummary(2602, "2026-08-24T06:00:00", { sport_type: "VirtualRide", distance: 30000, device_name: "Zwift" }),
    ],
  });
  const r = await run(db);
  net.restore();
  const adopt = db.rpcCalls.find((c) => c.name === "adopt_strava_session");
  const insert = db.rpcCalls.find((c) => c.name === "upsert_strava_session");
  check("TC-31 one adopt, one insert", r.adopted === 1 && r.imported === 1, r);
  check("TC-31 adopt_strava_session gets p_device_name", adopt?.args.p_device_name === "Concept2 PM5", adopt?.args);
  check("TC-31 upsert_strava_session gets p_device_name", insert?.args.p_device_name === "Zwift", insert?.args);

  // The update path (an already-linked activity) passes it too.
  db.rpcCalls.length = 0;
  db.state.sync.incremental_after = epochOf("2026-08-01T00:00:00Z");
  const net2 = installStrava({ activities: [fullSummary(2602, "2026-08-24T06:00:00",
    { sport_type: "VirtualRide", distance: 30000, device_name: "Zwift" })] });
  const r2 = await run(db);
  net2.restore();
  check("TC-31 update path passes p_device_name",
    r2.updated === 1 && db.rpcCalls[0]?.args.p_device_name === "Zwift", db.rpcCalls);
}
{
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const noDevice = fullSummary(2603, "2026-08-21T06:00:00", { device_name: undefined });
  const net = installStrava({ activities: [noDevice], detail: { 2603: noDevice } });
  await run(db);
  net.restore();
  check("TC-31 a missing device name is sent as null, not undefined",
    "p_device_name" in (db.rpcCalls[0]?.args ?? {}) && db.rpcCalls[0]?.args.p_device_name === null,
    db.rpcCalls[0]?.args);
}

// ---------------------------------------------------------------------------
// TC-32 — the daily rate cap
// ---------------------------------------------------------------------------
console.log("\nTC-32 daily rate cap");

const daily = (shortUsage: number, dailyUsage: number) => ({
  ...EMPTY_RATE_LIMIT, shortLimit: 100, shortUsage, dailyLimit: 1000, dailyUsage, source: "read" as const,
});
const byDaily = shouldStopChunk(1, 10, daily(1, 800), budget);
check("TC-32 80% of the DAILY quota stops a run inside its 15-minute budget",
  byDaily.stop && byDaily.reason === "daily_rate_limit", byDaily);
check("TC-32 just under 80% daily does not stop", shouldStopChunk(1, 10, daily(1, 799), budget).stop === false);
check("TC-32 daily outranks the short window when both are near their cap",
  shouldStopChunk(1, 10, daily(90, 900), budget).reason === "daily_rate_limit");
check("TC-32 missing daily headers: the short window behaves as before",
  shouldStopChunk(1, 10, { ...daily(80, 0), dailyLimit: null, dailyUsage: null }, budget).reason === "rate_limit" &&
    shouldStopChunk(1, 10, { ...daily(1, 0), dailyLimit: null, dailyUsage: null }, budget).stop === false);
check("TC-32 isNearDailyCap false without daily figures", isNearDailyCap(EMPTY_RATE_LIMIT) === false);
check("TC-32 isDailyCapExhausted only at the limit",
  isDailyCapExhausted(daily(1, 1000)) && !isDailyCapExhausted(daily(1, 999)));
check("TC-32 header-derived daily usage drives the stop",
  shouldStopChunk(0, 0, parseRateLimit(new Headers({
    "X-ReadRateLimit-Limit": "100,1000",
    "X-ReadRateLimit-Usage": "3,850",
  })), budget).reason === "daily_rate_limit");

check("TC-32 nextUtcMidnight rounds up to the next 00:00 UTC",
  nextUtcMidnight(Date.parse("2026-08-22T10:07:31Z")) === Date.parse("2026-08-23T00:00:00Z"));
check("TC-32 nextUtcMidnight exactly on midnight returns the FOLLOWING one",
  nextUtcMidnight(Date.parse("2026-08-23T00:00:00Z")) === Date.parse("2026-08-24T00:00:00Z"));
check("TC-32 nextUtcMidnight one ms before midnight",
  nextUtcMidnight(Date.parse("2026-08-22T23:59:59.999Z")) === Date.parse("2026-08-23T00:00:00Z"));

const NEXT_MIDNIGHT = "2026-08-29T00:00:00.000Z"; // after NOW_MS = 2026-08-28T00:00:00Z
const NEXT_QUARTER = "2026-08-28T00:15:00.000Z";
{
  // Daily usage at 80%, 15-minute usage low: the run stops, defers the
  // activity whose detail it would have fetched, and holds until midnight UTC.
  const s = summary(2701, "2026-08-21T07:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2701: detailed(s) }, limit: "100,1000", usage: "1,800" });
  const r = await run(db);
  net.restore();
  check("TC-32 daily stop: stopReason daily_rate_limit", r.stopReason === "daily_rate_limit", r);
  check("TC-32 daily stop: no detail fetch spent", net.detailCalls.length === 0, net.detailCalls);
  check("TC-32 daily stop: the activity is deferred, not written",
    r.deferred === 1 && db.rpcCalls.length === 0, r);
  check("TC-32 daily stop: held until next UTC midnight",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_MIDNIGHT, db.lastSyncPatch());
}
{
  // A 429 with the daily usage at its limit: wait for the daily reset.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [fullSummary(2702, "2026-08-21T07:00:00")],
    listStatus: () => 429,
    limit: "100,1000",
    usage: "5,1000",
  });
  const r = await run(db);
  net.restore();
  check("TC-32 daily-cap 429 -> rate_limited", r.status === "rate_limited", r);
  check("TC-32 daily-cap 429 -> reset at next UTC midnight",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_MIDNIGHT, db.lastSyncPatch());
}
{
  // A 429 from the 15-minute window keeps the quarter-hour hold.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [fullSummary(2703, "2026-08-21T07:00:00")],
    listStatus: () => 429,
    limit: "100,1000",
    usage: "100,500",
  });
  await run(db);
  net.restore();
  check("TC-32 short-window 429 -> reset at the next quarter hour",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_QUARTER, db.lastSyncPatch());
}
{
  // No daily figures in the headers: exactly today's behaviour.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [fullSummary(2704, "2026-08-21T07:00:00")],
    listStatus: () => 429,
    limit: "100",
    usage: "100",
  });
  await run(db);
  net.restore();
  check("TC-32 429 without daily headers -> quarter hour, as before",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_QUARTER, db.lastSyncPatch());
}
{
  // A clean run near neither cap arms no hold at all.
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [fullSummary(2705, "2026-08-21T07:00:00")], usage: "1,10" });
  await run(db);
  net.restore();
  check("TC-32 a run below both caps arms no hold", db.lastSyncPatch().rate_limit_resets_at === null,
    db.lastSyncPatch());
}

// ---------------------------------------------------------------------------
// TC-33 — a summary without device_name is detail-fetched, so a Garmin cannot
//         slip through (device_name is documented on DetailedActivity only)
// ---------------------------------------------------------------------------
console.log("\nTC-33 Garmin check needs the detail when the summary names no device");

const fullRide = (id: number, over: Partial<StravaActivity> = {}) =>
  fullSummary(id, "2026-08-21T07:00:00", { sport_type: "Ride", device_name: undefined, ...over });

check("TC-33 full Ride summary with no device_name needs detail", needsDetailFetch(fullRide(1)) === true);
check("TC-33 full Ride summary with device_name null needs detail",
  needsDetailFetch(fullRide(1, { device_name: null })) === true);
check("TC-33 full Ride summary naming a non-Garmin device needs no detail",
  needsDetailFetch(fullRide(1, { device_name: "Zwift" })) === false);
check("TC-33 a Walk with no device_name still costs no fetch",
  needsDetailFetch(act({ sport_type: "Walk", device_name: undefined })) === false);
{
  // (a) the detail names a Garmin: one fetch, skipped, nothing written, cursor moves.
  const s = fullRide(2801);
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2801: { ...s, device_name: "Garmin Edge 530" } } });
  const r = await run(db);
  net.restore();
  const dec = r.decisions.find((x) => x.activityId === 2801);
  check("TC-33 (a) exactly one detail fetch", net.detailCalls.join() === "2801", net.detailCalls);
  check("TC-33 (a) skipped garmin_attribution_pending",
    dec?.action === "skip" && dec?.detail === "garmin_attribution_pending", dec);
  check("TC-33 (a) no RPC call", db.rpcCalls.length === 0, db.rpcCalls);
  check("TC-33 (a) the cursor advances past it",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-21T07:00:00Z"), db.lastSyncPatch());
}
{
  // (b) the detail names no device either: not Garmin, imported.
  const s = fullRide(2802);
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2802: s } });
  const r = await run(db);
  net.restore();
  check("TC-33 (b) no device name anywhere -> imported",
    r.imported === 1 && net.detailCalls.join() === "2802" && db.rpcCalls[0]?.args.p_device_name === null,
    { r, rpc: db.rpcCalls });
}
{
  // (c) the detail names a non-Garmin device: imported, and the name recorded.
  const s = fullRide(2803);
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2803: { ...s, device_name: "Zwift" } } });
  const r = await run(db);
  net.restore();
  check("TC-33 (c) detail says Zwift -> imported with p_device_name Zwift",
    r.imported === 1 && db.rpcCalls[0]?.args.p_device_name === "Zwift", db.rpcCalls);
}
{
  // (d) a Walk with no device name costs no fetch in a real run either.
  const w = summary(2804, "2026-08-21T07:00:00", { sport_type: "Walk" });
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [w], detail: { 2804: w } });
  await run(db);
  net.restore();
  check("TC-33 (d) Walk without device_name -> no detail fetch", net.detailCalls.length === 0, net.detailCalls);
}
{
  // The fetch could not happen (budget spent): the usual deferral, not a write.
  const s = fullRide(2805);
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2805: s } });
  // 1 list call spends the whole budget.
  const r = await run(db, { budget: { maxCalls: 1, maxElapsedMs: 60_000 } });
  net.restore();
  check("TC-33 budget spent before the device check -> deferred, not written",
    r.deferred === 1 && db.rpcCalls.length === 0 && net.detailCalls.length === 0, { r, rpc: db.rpcCalls });
  check("TC-33 ... and the watermark is held below it",
    db.lastSyncPatch().incremental_after === epochOf("2026-08-21T07:00:00Z") - 1, db.lastSyncPatch());
}

// ---------------------------------------------------------------------------
// TC-34 — the daily cap wins over every other stop reason
// ---------------------------------------------------------------------------
console.log("\nTC-34 daily cap precedence");

const dailyBoth = shouldStopChunk(50, 25_000, daily(90, 900), budget);
check("TC-34 calls, elapsed and daily all true -> daily_rate_limit",
  dailyBoth.stop && dailyBoth.reason === "daily_rate_limit", dailyBoth);
check("TC-34 mergeStopReason keeps daily over a later calls stop",
  mergeStopReason("daily_rate_limit", "calls") === "daily_rate_limit");
check("TC-34 mergeStopReason keeps daily over a later 429",
  mergeStopReason("daily_rate_limit", "rate_limit") === "daily_rate_limit");
check("TC-34 mergeStopReason otherwise takes the newer reason",
  mergeStopReason("calls", "rate_limit") === "rate_limit" && mergeStopReason(null, "calls") === "calls" &&
    mergeStopReason("calls", "daily_rate_limit") === "daily_rate_limit");
{
  // Budget AND daily cap both spent by the first list call: daily wins, and
  // the hold is midnight UTC, not none.
  const s = summary(2901, "2026-08-21T07:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({ activities: [s], detail: { 2901: detailed(s) }, limit: "100,1000", usage: "1,800" });
  const r = await run(db, { budget: { maxCalls: 1, maxElapsedMs: 60_000 } });
  net.restore();
  check("TC-34 calls and daily both true in a run -> daily_rate_limit", r.stopReason === "daily_rate_limit", r);
  check("TC-34 ... held until next UTC midnight",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_MIDNIGHT, db.lastSyncPatch());
}
{
  // A daily stop followed by more stop checks later in the same run (two
  // deferrals, each re-testing the budget) still ends daily_rate_limit.
  const a1 = summary(2902, "2026-08-21T07:00:00");
  const a2 = summary(2903, "2026-08-22T07:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [a1, a2],
    detail: { 2902: detailed(a1), 2903: detailed(a2) },
    limit: "100,1000",
    usage: "1,800",
  });
  const r = await run(db, { budget: { maxCalls: 1, maxElapsedMs: 60_000 } });
  net.restore();
  check("TC-34 later stop checks in the same run keep daily_rate_limit",
    r.stopReason === "daily_rate_limit" && r.deferred === 2, r);
}

// ---------------------------------------------------------------------------
// TC-35 — two gaps the test analyst found
// ---------------------------------------------------------------------------
console.log("\nTC-35 detail-fetch daily 429; a legacy source='strava' row once adopted");
{
  // A 429 on the DETAIL fetch, with the daily usage at its limit.
  const s = summary(3001, "2026-08-21T07:00:00");
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens } });
  const net = installStrava({
    activities: [s],
    detail: { 3001: 429 },
    limit: "100,1000",
    usage: "1,10",
    detailUsage: "5,1000",
  });
  const r = await run(db);
  net.restore();
  check("TC-35 detail 429 at the daily limit -> rate_limited, deferred",
    r.status === "rate_limited" && r.deferred === 1 && db.rpcCalls.length === 0, r);
  check("TC-35 detail 429 at the daily limit -> held until next UTC midnight",
    db.lastSyncPatch().rate_limit_resets_at === NEXT_MIDNIGHT, db.lastSyncPatch());
}
{
  // One of the six legacy rows that carry source = 'strava' from a hand import.
  const a = fullSummary(3002, "2026-08-20T06:00:00");
  const legacy: SessionRow = {
    id: 3010, strava_activity_id: null, date_iso: "2026-08-20", type: "erg", distance_m: 6002,
    duration: "25min", source: "strava",
  };
  const db = makeDb({ sync: syncRow(), tokens: { ...freshTokens }, sessions: [legacy] });
  const net1 = installStrava({ activities: [a] });
  const r1 = await run(db);
  net1.restore();
  check("TC-35 a legacy source='strava' row is adopted", r1.adopted === 1 && r1.imported === 0, r1);

  db.rpcCalls.length = 0;
  db.state.sync.incremental_after = epochOf("2026-08-01T00:00:00Z");
  const net2 = installStrava({ activities: [fullSummary(3002, "2026-08-20T06:00:00", { moving_time: 1530 })] });
  const r2 = await run(db);
  net2.restore();
  const row = db.state.sessions.find((x) => x.id === 3010);
  check("TC-35 ... re-upserted on the next run", r2.updated === 1 && db.rpcCalls.length === 1, r2);
  check("TC-35 ... and keeps its hand-filed duration and distance",
    row?.duration === "25min" && row?.distance_m === 6002, row);
}

if (savedDsn === undefined) Deno.env.delete("SENTRY_DSN");
else Deno.env.set("SENTRY_DSN", savedDsn);

console.log("\nRESULT:", pass, "passed,", fail, "failed");
if (fail) Deno.exit(1);
