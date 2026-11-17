// deletion_test.ts — the #630 deletion paths: the deletion sync (reconcile.ts),
// the revocation purge (purge.ts) and the pure helpers both rest on. Same
// harness and same way of running as test.ts:
//
//   deno run --allow-env strava-import/deletion_test.ts
//
// The SQL behind the RPCs is exercised by migration 019's self-test; these fakes
// model only the RPCs' contract. What they pin is the edge-function half: which
// RPC is called with what, and — the safety property — that every abort happens
// BEFORE any delete RPC.
import {
  candidateCap,
  INVENTORY_MAX_PAGES,
  INVENTORY_PAGE,
  isReconcileDue,
  RECONCILE_DUE_SLACK_MS,
  RECONCILE_INTERVAL_MS,
  RECONCILE_RETRY_MS,
  reconcileWindowAfter,
  reconcileRevoked,
  reconcileWindowStartISO,
  runReconcile,
  selectCandidates,
  type LinkRow,
  type ReconcileSync,
} from "./reconcile.ts";
import { revocationLanded, runRevocationPurge, type RevocationResult } from "./purge.ts";
import {
  DAY_MS,
  isNearDailyCap,
  PURGE_GRACE_DAYS,
  RATE_LIMIT_STOP_FRACTION,
  RECONCILE_STOP_FRACTION,
  revokedPatch,
  shouldStopChunk,
} from "./state.ts";
import { EMPTY_RATE_LIMIT } from "./client.ts";
import { harness, installStravaHttp, makePurgeDb, type Row, silenceSentry } from "./testkit.ts";

const { check, finish } = harness();
const restoreSentry = silenceSentry();

const USER = "11111111-2222-3333-4444-555555555555";
const NOW = Date.parse("2026-08-28T00:00:00Z");
const NOW_ISO = new Date(NOW).toISOString();
const BACKFILL_FROM = "2026-01-01";
const utc = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

// ---------------------------------------------------------------------------
console.log("\nDT-01 pure helpers");
// ---------------------------------------------------------------------------

// The window is min(link dates, backfill_from) minus two days, across a year boundary.
check("DT-01 window from the earliest link when it precedes backfill_from",
  reconcileWindowStartISO(["2026-01-01", "2025-12-31"], "2026-03-01") === "2025-12-29");
check("DT-01 window after = UTC epoch of that date",
  reconcileWindowAfter(["2026-01-01", "2025-12-31"], "2026-03-01") === utc("2025-12-29"));
check("DT-01 window from backfill_from when the links are later",
  reconcileWindowAfter(["2026-05-01"], "2026-01-01") === utc("2025-12-30"));
check("DT-01 null link dates are ignored",
  reconcileWindowStartISO([null, "2026-02-03"], "2026-03-01") === "2026-02-01");
// Midnight: a link dated 2026-01-01 local whose activity started 2025-12-31T14:00Z
// (UTC+10) is inside the listed window, so it cannot be called deleted for
// falling outside it.
check("DT-01 a local-midnight activity is inside the window",
  Date.parse("2025-12-31T14:00:00Z") / 1000 > reconcileWindowAfter(["2026-01-01"], "2026-01-01"));

check("DT-01 candidateCap(10) = 3 (the floor)", candidateCap(10) === 3, candidateCap(10));
check("DT-01 candidateCap(100) = 20", candidateCap(100) === 20, candidateCap(100));
check("DT-01 candidateCap(0) = 3", candidateCap(0) === 3, candidateCap(0));

{
  const links: LinkRow[] = [
    { session_id: 1, strava_activity_id: 101, date_iso: "2026-02-01", link_created_at: "2026-08-01T00:00:00+00:00" },
    { session_id: 2, strava_activity_id: 102, date_iso: "2026-02-02", link_created_at: "2026-08-01T00:00:00+00:00" },
    // Linked AT the listing start: may have been listed already, never a candidate.
    { session_id: 3, strava_activity_id: 103, date_iso: "2026-02-03", link_created_at: NOW_ISO },
    // Linked after it.
    { session_id: 4, strava_activity_id: 104, date_iso: "2026-02-04", link_created_at: "2026-08-28T00:00:01+00:00" },
  ];
  const { candidates, base } = selectCandidates(links, new Set([101]), NOW, "2026-01-30");
  check("DT-01 selectCandidates: listed links are not candidates; recent links are excluded",
    candidates.map((c) => c.strava_activity_id).join() === "102", candidates);
  check("DT-01 selectCandidates: base counts every link in the window", base === 4, base);
}

check("DT-01 isReconcileDue: null is due", isReconcileDue({ reconcile_due_at: null }, NOW));
check("DT-01 isReconcileDue: past is due", isReconcileDue({ reconcile_due_at: "2026-08-27T00:00:00Z" }, NOW));
check("DT-01 isReconcileDue: inside the slack is due",
  isReconcileDue({ reconcile_due_at: new Date(NOW + RECONCILE_DUE_SLACK_MS).toISOString() }, NOW));
check("DT-01 isReconcileDue: beyond the slack is not due",
  !isReconcileDue({ reconcile_due_at: new Date(NOW + RECONCILE_DUE_SLACK_MS + 1000).toISOString() }, NOW));
check("DT-01 isReconcileDue: unparseable is due", isReconcileDue({ reconcile_due_at: "garbage" }, NOW));

// AC23 (state units): 0.5 trips at 50/100; the default stays 0.8.
{
  const at50 = { ...EMPTY_RATE_LIMIT, shortLimit: 100, shortUsage: 50, source: "read" as const };
  const at49 = { ...EMPTY_RATE_LIMIT, shortLimit: 100, shortUsage: 49, source: "read" as const };
  const budget = { maxCalls: 50, maxElapsedMs: 20_000 };
  check("DT-01 RECONCILE_STOP_FRACTION is 0.5", RECONCILE_STOP_FRACTION === 0.5);
  check("DT-01 shouldStopChunk at 0.5 trips at 50/100",
    shouldStopChunk(0, 0, at50, budget, RECONCILE_STOP_FRACTION).reason === "rate_limit");
  check("DT-01 shouldStopChunk at 0.5 does not trip at 49/100",
    !shouldStopChunk(0, 0, at49, budget, RECONCILE_STOP_FRACTION).stop);
  check("DT-01 the default fraction is unchanged (0.8): 50/100 does not stop",
    RATE_LIMIT_STOP_FRACTION === 0.8 && !shouldStopChunk(0, 0, at50, budget).stop);
  const daily500 = { ...EMPTY_RATE_LIMIT, dailyLimit: 1000, dailyUsage: 500, source: "read" as const };
  check("DT-01 isNearDailyCap honours a fraction", isNearDailyCap(daily500, 0.5) && !isNearDailyCap(daily500));
  check("DT-01 shouldStopChunk at 0.5 reports the daily cap at 500/1000",
    shouldStopChunk(0, 0, daily500, budget, 0.5).reason === "daily_rate_limit");
}

// AC10 (pure half): revokedPatch sets the deadline once.
{
  const fresh = revokedPatch({ purge_due_at: null }, "cron", NOW);
  check("DT-01 revokedPatch schedules the purge 21 days out",
    PURGE_GRACE_DAYS === 21 && fresh.purge_due_at === new Date(NOW + 21 * DAY_MS).toISOString(), fresh);
  check("DT-01 revokedPatch marks the connection down with auth_failed",
    fresh.connected === false && fresh.last_run_status === "auth_failed" && fresh.last_error_code === "auth_failed",
    fresh);
  const kept = revokedPatch({ purge_due_at: "2026-09-01T00:00:00.000Z" }, "user", NOW);
  check("DT-01 revokedPatch never pushes an existing deadline later",
    kept.purge_due_at === "2026-09-01T00:00:00.000Z", kept);
  check("DT-01 revokedPatch carries no cursor or token field",
    !("backfill_cursor_before" in fresh) && !("incremental_after" in fresh) && !("access_token" in fresh), fresh);
}

// ---------------------------------------------------------------------------
// runReconcile
// ---------------------------------------------------------------------------

const link = (id: number, over: Partial<LinkRow> = {}): Row => ({
  session_id: 5000 + id,
  strava_activity_id: id,
  date_iso: "2026-02-01",
  link_created_at: "2026-08-01T00:00:00+00:00",
  ...over,
});

const syncRow = (over: Partial<ReconcileSync> = {}): Row => ({
  user_id: USER,
  connected: true,
  backfill_from: BACKFILL_FROM,
  reconcile_due_at: null,
  rate_limit_resets_at: null,
  purge_due_at: null,
  ...over,
});

const purgeResult = (args: Row) => {
  const ids = args.p_activity_ids as number[];
  return {
    status: args.p_dry_run ? "would_purge" : "purged",
    deleted: ids.length,
    kept: 0,
    restored: 0,
    not_found: 0,
    actions: ids.map((id) => ({ activity_id: id, action: "delete" })),
  };
};

type RecOpts = {
  links: Row[];
  http: Parameters<typeof installStravaHttp>[0];
  sync?: Row;
  dryRun?: boolean;
  deps?: Record<string, unknown>;
  rpcFails?: (name: string, args: Row, range?: [number, number]) => { code: string } | undefined;
};

async function rec(o: RecOpts) {
  const sync = o.sync ?? syncRow();
  const db = makePurgeDb({
    syncRows: [sync],
    rpcResults: { strava_link_inventory: o.links, purge_strava_activities: purgeResult },
    rpcFails: o.rpcFails,
  });
  const net = installStravaHttp(o.http);
  try {
    const r = await runReconcile(
      // deno-lint-ignore no-explicit-any
      { supa: db.supa, accessToken: "live-access", backfillFrom: BACKFILL_FROM, now: () => NOW, ...o.deps } as any,
      // deno-lint-ignore no-explicit-any
      { userId: USER, mode: "cron", dryRun: o.dryRun ?? false, sync: sync as any },
    );
    return { r, db, net };
  } finally {
    net.restore();
  }
}

/** A ReconcileDeps.report spy: records each report's stage. */
const reportSpy = () => {
  const stages: string[] = [];
  const report = (_fn: string, _err: unknown, ctx: Record<string, unknown> = {}) => {
    stages.push(String(ctx.stage));
    return Promise.resolve();
  };
  return { stages, report };
};

const purgeRpc = (db: ReturnType<typeof makePurgeDb>) => db.rpcCalls.filter((c) => c.name === "purge_strava_activities");
const lastSyncUpdate = (db: ReturnType<typeof makePurgeDb>) => db.syncUpdates().at(-1)?.payload as Row | undefined;
const tenLinks = Array.from({ length: 10 }, (_, i) => link(1001 + i));
const listedExcept = (missing: number[], all = tenLinks) =>
  all.map((l) => ({ id: l.strava_activity_id as number })).filter((a) => !missing.includes(a.id));

console.log("\nDT-02 reconcile — the happy path (AC16, AC21, Q-C)");
{
  const { r, db, net } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1010])] },
  });
  const p = purgeRpc(db);
  check("DT-02 one missing + 404 -> purge_strava_activities with [X]",
    p.length === 1 && (p[0].args.p_activity_ids as number[]).join() === "1010", p);
  check("DT-02 the RPC gets the listing start as p_linked_before (AC21)",
    p[0]?.args.p_linked_before === NOW_ISO && p[0]?.args.p_dry_run === false, p[0]?.args);
  check("DT-02 status ok with counts", r.status === "ok" && r.ok && r.confirmedGone === 1 && r.deleted === 1, r);
  check("DT-02 the listing is fixed at the window start, page 1",
    net.of("list")[0]?.url.includes(`after=${utc("2025-12-30")}`) && net.of("list")[0]?.url.includes("page=1"),
    net.of("list"));
  check("DT-02 one list call + one detail call", r.stravaCalls === 2 && net.of("detail").length === 1, r);
  check("DT-02 ok writes reconcile_due_at = now + 12 h (Q-C)",
    lastSyncUpdate(db)?.reconcile_due_at === new Date(NOW + RECONCILE_INTERVAL_MS).toISOString(), lastSyncUpdate(db));
  check("DT-02 a real run returns NO decisions / activity ids (Q-D)", !("decisions" in r), r);
}
{
  // Nothing missing: no detail fetch, no RPC.
  const { r, db, net } = await rec({ links: tenLinks, http: { listPages: [listedExcept([])] } });
  check("DT-02 nothing missing -> ok, no detail, no purge",
    r.status === "ok" && net.of("detail").length === 0 && purgeRpc(db).length === 0, r);
}
{
  // A link made at the listing start is never a candidate, so never fetched.
  const links = [...tenLinks.slice(0, 9), link(1010, { link_created_at: NOW_ISO })];
  const { r, db, net } = await rec({ links, http: { listPages: [listedExcept([1010], links)] } });
  check("DT-02 a link created at/after the listing start is excluded (AC21)",
    r.candidates === 0 && net.of("detail").length === 0 && purgeRpc(db).length === 0, r);
}
{
  // A full page then a short one: exhausted only on the short page.
  const many = Array.from({ length: 150 }, (_, i) => link(2001 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const { r, net } = await rec({ links: many, http: { listPages: [all.slice(0, 100), all.slice(100)] } });
  check("DT-02 pages until a short page, `after` fixed",
    r.status === "ok" && net.of("list").length === 2 && net.of("list")[1].url.includes("page=2") &&
      net.of("list").every((c) => c.url.includes(`after=${utc("2025-12-30")}`)), net.of("list"));
}

console.log("\nDT-03 reconcile — listing aborts delete nothing (AC17)");
{
  // Call budget spent after one full page.
  const many = Array.from({ length: 150 }, (_, i) => link(3001 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const spy = reportSpy();
  const { r, db } = await rec({
    links: many,
    http: { listPages: [all.slice(0, 100), all.slice(100)] },
    deps: { budget: { maxCalls: 1, maxElapsedMs: 60_000 }, report: spy.report },
  });
  check("DT-03 budget stop after a full page -> truncated, no delete RPC",
    r.status === "truncated" && purgeRpc(db).length === 0, r);
  check("DT-03 squeezed budget stops -> truncated/budget, no report",
    r.status === "truncated" && r.reason === "budget" && spy.stages.length === 0, { r, stages: spy.stages });
  check("DT-03 an abort writes reconcile_due_at = now + 1 h (Q-C)",
    lastSyncUpdate(db)?.reconcile_due_at === new Date(NOW + RECONCILE_RETRY_MS).toISOString(), lastSyncUpdate(db));
}
{
  // The full 20-call ceiling spent on full pages: the window cannot fit in a pass.
  const many = Array.from({ length: 2100 }, (_, i) => link(100_001 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const pages = Array.from({ length: 21 }, (_, i) => all.slice(i * 100, (i + 1) * 100));
  const spy = reportSpy();
  const { r, db, net } = await rec({ links: many, http: { listPages: pages }, deps: { report: spy.report } });
  check("DT-03 ceiling: 20 full pages -> truncated/ceiling, one reconcile_ceiling report, no delete RPC",
    r.status === "truncated" && r.reason === "ceiling" && net.of("list").length === 20 &&
      spy.stages.join() === "reconcile_ceiling" && purgeRpc(db).length === 0, { r, stages: spy.stages });
}
{
  // 150 links, 25 unlisted (cap 30): two list calls, then 18 detail calls reach 20.
  const many = Array.from({ length: 150 }, (_, i) => link(110_001 + i));
  const missing = Array.from({ length: 25 }, (_, i) => 110_001 + i);
  const listed = listedExcept(missing, many);
  const spy = reportSpy();
  const { r, db, net } = await rec({
    links: many,
    http: { listPages: [listed.slice(0, 100), listed.slice(100)] },
    deps: { report: spy.report },
  });
  check("DT-03 ceiling at a candidate fetch -> truncated/ceiling, one reconcile_ceiling report",
    r.status === "truncated" && r.reason === "ceiling" && net.of("list").length === 2 &&
      net.of("detail").length === 18 && spy.stages.join() === "reconcile_ceiling" && purgeRpc(db).length === 0,
    { r, stages: spy.stages });
}
{
  // Usage at 50% of the short window after page 1.
  const many = Array.from({ length: 150 }, (_, i) => link(3201 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const { r, db, net } = await rec({
    links: many,
    http: { listPages: [all.slice(0, 100), all.slice(100)], usage: "50,60" },
  });
  check("DT-03 usage >= 50% stops -> truncated, no delete RPC",
    r.status === "truncated" && net.of("list").length === 1 && purgeRpc(db).length === 0, r);
}
{
  // The import's last-seen quota already at 50%: not even one call.
  const { r, net } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([])] },
    deps: { rateLimit: { ...EMPTY_RATE_LIMIT, shortLimit: 100, shortUsage: 60, source: "read" } },
  });
  check("DT-03 a spent quota inherited from the import stops before any call",
    r.status === "truncated" && net.calls.length === 0, r);
}
{
  const many = Array.from({ length: 150 }, (_, i) => link(3401 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const { r, db } = await rec({
    links: many,
    http: { listPages: [all.slice(0, 100), all.slice(100)], listStatus: (c) => (c === 2 ? 500 : undefined) },
  });
  check("DT-03 page 2 HTTP 500 -> listing_failed, no delete RPC",
    r.status === "listing_failed" && r.reason === "http_500" && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: { listPages: [[]] } });
  check("DT-03 empty listing with links present -> listing_empty, no delete RPC",
    r.status === "listing_empty" && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: { listBody: () => ({ message: "not a list" }) } });
  check("DT-03 non-array 200 -> listing_malformed, no delete RPC",
    r.status === "listing_malformed" && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: { listStatus: () => 429 } });
  const u = lastSyncUpdate(db);
  check("DT-03 429 -> listing_failed rate_limited, no delete RPC",
    r.status === "listing_failed" && r.reason === "rate_limited" && purgeRpc(db).length === 0, r);
  check("DT-03 429 writes rate_limit_resets_at = next quarter hour",
    u?.rate_limit_resets_at === new Date(NOW + 15 * 60_000).toISOString(), u);
  check("DT-03 ... and the hour retry", u?.reconcile_due_at === new Date(NOW + RECONCILE_RETRY_MS).toISOString(), u);
}
{
  const { db } = await rec({ links: tenLinks, http: { listStatus: () => 429, usage: "100,1000", limit: "100,1000" } });
  check("DT-03 a daily-cap 429 holds until next UTC midnight",
    lastSyncUpdate(db)?.rate_limit_resets_at === "2026-08-29T00:00:00.000Z", lastSyncUpdate(db));
}
{
  // Listing 401 -> revokedPatch.
  const { r, db } = await rec({ links: tenLinks, http: { listStatus: () => 401 } });
  const u = lastSyncUpdate(db);
  check("DT-03 listing 401 -> auth_failed, revokedPatch, no delete RPC",
    r.status === "auth_failed" && u?.connected === false && u?.purge_due_at === new Date(NOW + 21 * DAY_MS).toISOString() &&
      purgeRpc(db).length === 0, { r, u });
}

{
  // Q-C, table-driven: every abort status retries in an hour (non-dry).
  const many = Array.from({ length: 150 }, (_, i) => link(3601 + i));
  const all = many.map((l) => ({ id: l.strava_activity_id as number }));
  const aborts: [string, RecOpts][] = [
    ["listing_failed", { links: tenLinks, http: { listStatus: () => 500 } }],
    ["listing_malformed", { links: tenLinks, http: { listBody: () => ({ message: "not a list" }) } }],
    ["listing_empty", { links: tenLinks, http: { listPages: [[]] } }],
    ["capped", { links: tenLinks, http: { listPages: [listedExcept([1007, 1008, 1009, 1010])] } }],
    ["detail_failed", { links: tenLinks, http: { listPages: [listedExcept([1010])], detail: { 1010: 500 } } }],
    ["truncated", {
      links: many,
      http: { listPages: [all.slice(0, 100), all.slice(100)] },
      deps: { budget: { maxCalls: 1, maxElapsedMs: 60_000 } },
    }],
  ];
  for (const [want, o] of aborts) {
    const { r, db } = await rec(o);
    const u = lastSyncUpdate(db);
    check(`DT-03 Q-C ${want} writes reconcile_due_at = now + 1 h, no delete RPC`,
      r.status === want && u?.reconcile_due_at === new Date(NOW + RECONCILE_RETRY_MS).toISOString() &&
        purgeRpc(db).length === 0, { status: r.status, u });
  }
  const { r, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([])] },
    sync: syncRow({ rate_limit_resets_at: "2026-08-28T00:10:00Z" }),
  });
  check("DT-03 Q-C skipped_rate_limited writes no reconcile_due_at",
    r.status === "skipped_rate_limited" &&
      !db.syncUpdates().some((c) => "reconcile_due_at" in (c.payload as Row)), db.syncUpdates());
}

console.log("\nDT-04 reconcile — the detail fetch (AC19)");
{
  const { r, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1010])], detail: { 1010: { id: 1010 } } },
  });
  check("DT-04 detail 200 -> kept (present), no delete RPC",
    r.status === "ok" && r.confirmedGone === 0 && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: { listPages: [listedExcept([1010])], detail: { 1010: 401 } } });
  const u = lastSyncUpdate(db);
  check("DT-04 detail 401 -> auth_failed with revokedPatch, no delete RPC",
    r.status === "auth_failed" && u?.last_run_status === "auth_failed" && u?.purge_due_at != null &&
      purgeRpc(db).length === 0, { r, u });
}
for (const [label, d] of [["403", 403], ["429", 429], ["500", 500], ["timeout", "timeout"], ["network", "network"], [
  "null body",
  "null",
]] as const) {
  // Candidate 1009 404s first, then 1010 fails: the earlier confirmation must
  // NOT be acted on — every abort happens before the delete.
  const { r, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1009, 1010])], detail: { 1009: 404, 1010: d } },
    deps: { timeoutMs: 30 },
  });
  check(`DT-04 detail ${label} after an earlier 404 -> detail_failed, NO delete RPC`,
    r.status === "detail_failed" && purgeRpc(db).length === 0, r);
}
{
  const { r } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1010])], detail: { 1010: "timeout" } },
    deps: { timeoutMs: 30 },
  });
  check("DT-04 a hanging detail fetch is cut off by the timeout", r.reason === "timeout", r);
}

console.log("\nDT-05 reconcile — the cap (AC20)");
{
  const { r, db, net } = await rec({ links: tenLinks, http: { listPages: [listedExcept([1007, 1008, 1009, 1010])] } });
  check("DT-05 4 of 10 missing -> capped, no detail fetch, no RPC",
    r.status === "capped" && r.cap === 3 && net.of("detail").length === 0 && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: { listPages: [listedExcept([1008, 1009, 1010])] } });
  check("DT-05 3 of 10 missing -> proceeds to the delete", r.status === "ok" && purgeRpc(db).length === 1, r);
}
{
  const hundred = Array.from({ length: 100 }, (_, i) => link(4001 + i));
  const missing = Array.from({ length: 21 }, (_, i) => 4001 + i);
  const { r, db, net } = await rec({ links: hundred, http: { listPages: [listedExcept(missing, hundred)] } });
  check("DT-05 21 of 100 missing -> capped (cap 20)",
    r.status === "capped" && r.cap === 20 && net.of("detail").length === 0 && purgeRpc(db).length === 0, r);
}
{
  const { r, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1007, 1008, 1009, 1010])] },
    dryRun: true,
  });
  check("DT-05 a dry run is capped the same way", r.status === "capped" && purgeRpc(db).length === 0, r);
}
{
  // 1,001 links: an unpaged RPC would stop at max_rows and drop the last one.
  const big = Array.from({ length: INVENTORY_PAGE + 1 }, (_, i) => link(200_001 + i));
  const { r, db, net } = await rec({ links: big, http: { listStatus: () => 500 } });
  const inv = db.rpcCalls.filter((c) => c.name === "strava_link_inventory");
  check("DT-05 inventory pages past 1,000: range(0,999) then range(1000,1999), links = 1001",
    inv.length === 2 && JSON.stringify(inv.map((c) => c.range)) === "[[0,999],[1000,1999]]" && r.links === 1001 &&
      net.of("list").length === 1, { ranges: inv.map((c) => c.range), links: r.links });
}
{
  const big = Array.from({ length: INVENTORY_PAGE + 1 }, (_, i) => link(300_001 + i));
  const { r, db, net } = await rec({
    links: big,
    http: { listPages: [[]] },
    rpcFails: (n, _a, range) =>
      n === "strava_link_inventory" && range?.[0] === INVENTORY_PAGE ? { code: "XX000" } : undefined,
  });
  check("DT-05 inventory error on page 2 -> error/inventory_failed, no list call",
    r.status === "error" && r.reason === "inventory_failed" && net.calls.length === 0 && purgeRpc(db).length === 0, r);
}
{
  // Row 1,000 (page 2) repeats row 0's session_id.
  const rows = Array.from({ length: INVENTORY_PAGE }, (_, i) => link(400_001 + i));
  rows.push(link(500_001, { session_id: rows[0].session_id as number }));
  const { r } = await rec({ links: rows, http: { listStatus: () => 500 } });
  check("DT-05 overlapping inventory pages dedupe on session_id", r.links === INVENTORY_PAGE, r.links);
}
{
  // A full page on every call up to the cap: 50 full pages and more behind them.
  const endless = Array.from({ length: INVENTORY_MAX_PAGES * INVENTORY_PAGE + 1 }, (_, i) => link(1_000_001 + i));
  const { r, net } = await rec({ links: endless, http: {} });
  check("DT-05 inventory page cap -> error/inventory_failed",
    r.status === "error" && r.reason === "inventory_failed" && net.calls.length === 0, r);
}

console.log("\nDT-06 reconcile — dry run, gates, failures (AC22, AC23)");
// deno-lint-ignore no-explicit-any
const withRec = (status: string): any => ({ reconcile: { status } });
check("DT-06 reconcileRevoked: true for reconcile.status auth_failed; false for ok, for no reconcile, and for []",
  reconcileRevoked([withRec("ok"), withRec("auth_failed")]) && !reconcileRevoked([withRec("ok")]) &&
    !reconcileRevoked([{}]) && !reconcileRevoked([]));
{
  const { r, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1009, 1010])], detail: { 1009: { id: 1009 } } },
    // Not due: a dry run ignores that (D7).
    sync: syncRow({ reconcile_due_at: "2099-01-01T00:00:00Z" }),
    dryRun: true,
  });
  const p = purgeRpc(db);
  check("DT-06 dry run ignores the due time and passes p_dry_run:true",
    p.length === 1 && p[0].args.p_dry_run === true, p);
  check("DT-06 dry run writes no sync state", db.syncUpdates().length === 0, db.syncUpdates());
  check("DT-06 dry run returns decisions (present + delete)",
    r.decisions?.some((d) => d.activityId === 1009 && d.action === "keep_present") === true &&
      r.decisions?.some((d) => d.activityId === 1010 && d.action === "delete") === true, r.decisions);
}
{
  const { r, net, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([])] },
    sync: syncRow({ rate_limit_resets_at: "2026-08-28T00:10:00Z" }),
  });
  check("DT-06 a pending rate-limit hold -> skipped_rate_limited, zero fetches, no RPC",
    r.status === "skipped_rate_limited" && net.calls.length === 0 && db.rpcCalls.length === 0 &&
      db.syncUpdates().length === 0, r);
}
{
  const { r, net, db } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([])] },
    sync: syncRow({ reconcile_due_at: "2026-08-28T06:00:00Z" }),
  });
  check("DT-06 not due -> not_due, no call, no write",
    r.status === "not_due" && net.calls.length === 0 && db.rpcCalls.length === 0 && db.syncUpdates().length === 0, r);
}
{
  const { r, db } = await rec({ links: tenLinks, http: {}, sync: syncRow({ connected: false }) });
  check("DT-06 not connected -> noop, nothing read or written",
    r.status === "noop" && db.rpcCalls.length === 0 && db.syncUpdates().length === 0, r);
}
{
  const { r, db, net } = await rec({ links: [], http: {} });
  check("DT-06 no links -> noop, no Strava call", r.status === "noop" && net.calls.length === 0, r);
  check("DT-06 no links still schedules the next pass (+12 h)",
    lastSyncUpdate(db)?.reconcile_due_at === new Date(NOW + RECONCILE_INTERVAL_MS).toISOString(), lastSyncUpdate(db));
}
{
  const { r, db, net } = await rec({
    links: tenLinks,
    http: {},
    rpcFails: (n) => (n === "strava_link_inventory" ? { code: "XX000" } : undefined),
  });
  check("DT-06 inventory RPC error -> error, no Strava call, +1 h",
    r.status === "error" && net.calls.length === 0 &&
      lastSyncUpdate(db)?.reconcile_due_at === new Date(NOW + RECONCILE_RETRY_MS).toISOString(), r);
}
{
  const { r } = await rec({
    links: tenLinks,
    http: { listPages: [listedExcept([1010])] },
    rpcFails: (n) => (n === "purge_strava_activities" ? { code: "XX000" } : undefined),
  });
  check("DT-06 purge RPC error -> error", r.status === "error" && !r.ok, r);
}

// ---------------------------------------------------------------------------
console.log("\nDT-07 revocation purge (AC12, AC13, AC14)");
// ---------------------------------------------------------------------------
const purgeUserResult = (args: Row) => ({
  status: args.p_dry_run ? "would_purge" : "purged",
  reason: args.p_reason,
  dry_run: args.p_dry_run,
  deleted: 2,
  kept: 1,
  restored: 2,
  orphans_unlinked: 1,
  token_removed: true,
  oauth_states_removed: 0,
  sync_state_removed: true,
});
const DUE = "2026-08-27T00:00:00.000Z";
const LATER = "2026-09-10T00:00:00.000Z";
const revocationRows = (): Row[] => [
  { user_id: "due-user", connected: false, purge_due_at: DUE },
  { user_id: "not-yet", connected: false, purge_due_at: LATER },
  { user_id: "connected", connected: true, purge_due_at: DUE },
  { user_id: "never", connected: false, purge_due_at: null },
];
{
  const db = makePurgeDb({ syncRows: revocationRows(), rpcResults: { purge_strava_user: purgeUserResult } });
  const net = installStravaHttp({});
  const out = await runRevocationPurge({ supa: db.supa, now: () => NOW }, { dryRun: false });
  net.restore();
  const sel = db.log.find((c) => c.table === "strava_sync_state" && c.op === "select");
  check("DT-07 selects connected=false AND purge_due_at <= now",
    JSON.stringify(sel?.filters) === JSON.stringify([["eq", ["connected", false]], ["lte", ["purge_due_at", NOW_ISO]]]),
    sel?.filters);
  check("DT-07 only the due user gets the RPC (AC13)",
    db.rpcCalls.length === 1 && db.rpcCalls[0].args.p_user_id === "due-user", db.rpcCalls);
  check("DT-07 ... with reason 'revocation' and a real run (AC12)",
    db.rpcCalls[0]?.args.p_reason === "revocation" && db.rpcCalls[0]?.args.p_dry_run === false, db.rpcCalls[0]);
  check("DT-07 zero Strava calls of any kind, deauthorize included", net.calls.length === 0, net.calls);
  check("DT-07 the result is counts and a status",
    out.length === 1 && out[0].status === "purged" && out[0].deleted === 2 && out[0].kept === 1 &&
      out[0].restored === 2 && out[0].orphansUnlinked === 1, out);
  check("DT-07 the function itself writes nothing (the RPC does)", db.writes().length === 0, db.writes());
}
{
  const db = makePurgeDb({ syncRows: revocationRows(), rpcResults: { purge_strava_user: purgeUserResult } });
  const out = await runRevocationPurge({ supa: db.supa, now: () => NOW }, { dryRun: true });
  check("DT-07 dry run passes p_dry_run:true (AC14)", db.rpcCalls[0]?.args.p_dry_run === true, db.rpcCalls);
  check("DT-07 dry run writes nothing", db.writes().length === 0 && out[0].status === "would_purge", out);
}
{
  const rows = [...revocationRows(), { user_id: "due-2", connected: false, purge_due_at: DUE }];
  const db = makePurgeDb({
    syncRows: rows,
    rpcResults: { purge_strava_user: purgeUserResult },
    rpcFails: (_n, a) => (a.p_user_id === "due-user" ? { code: "XX000" } : undefined),
  });
  const out = await runRevocationPurge({ supa: db.supa, now: () => NOW }, { dryRun: false });
  check("DT-07 one athlete's RPC error is its own 'error' entry; the next still runs",
    out.length === 2 && out[0].status === "error" && out[1].status === "purged", out);
}
{
  const db = makePurgeDb({
    syncRows: revocationRows(),
    rpcResults: { purge_strava_user: () => ({ status: "reconnected", deleted: 0 }) },
  });
  const reports: { err: unknown; ctx: Record<string, unknown> }[] = [];
  const out = await runRevocationPurge({
    supa: db.supa,
    now: () => NOW,
    report: (_fn, err, ctx = {}) => {
      reports.push({ err, ctx });
      return Promise.resolve();
    },
  }, { dryRun: false });
  check("DT-07 a 'reconnected' answer is reported as such", out[0]?.status === "reconnected", out);
  const msg = reports[0]?.err instanceof Error ? reports[0].err.message : "";
  check("DT-07 ... and captured once to Sentry, naming the status",
    reports.length === 1 && msg.includes("reconnected"), reports);
  check("DT-07 ... with no user, activity or token id in the message or context",
    !msg.includes("due-user") && !JSON.stringify(reports[0]?.ctx ?? {}).includes("due-user"), reports);
}
{
  const db = makePurgeDb({ syncRows: revocationRows(), rpcResults: { purge_strava_user: purgeUserResult } });
  const reports: unknown[] = [];
  await runRevocationPurge({
    supa: db.supa,
    now: () => NOW,
    report: (_fn, err) => {
      reports.push(err);
      return Promise.resolve();
    },
  }, { dryRun: false });
  check("DT-07 a clean purge captures nothing", reports.length === 0, reports);
}
{
  const entry = (status: RevocationResult["status"]): RevocationResult => ({
    userId: "u",
    status,
    deleted: 0,
    kept: 0,
    restored: 0,
    orphansUnlinked: 0,
  });
  check("DT-07 revocationLanded: reconnected or error -> false (index.ts answers 207)",
    !revocationLanded([entry("purged"), entry("reconnected")]) && !revocationLanded([entry("error")]), null);
  check("DT-07 revocationLanded: purged / would_purge / not_due / no_state / none -> true",
    revocationLanded([entry("purged"), entry("would_purge"), entry("not_due"), entry("no_state")]) &&
      revocationLanded([]), null);
}

restoreSentry();
finish();
