// strava-connect test suite (#630): the disconnect preview and confirm, and the
// reconnect patch the OAuth callback writes. Same hand-rolled harness as
// strava-import/test.ts, run the same way:
//
//   deno run --allow-env --allow-read=strava-oauth-callback/index.ts strava-connect/test.ts
//
// (from supabase/functions). The read grant is for CT-05's static check of the
// callback's source, scoped to that one file.
//
// The real client.ts deauthorize and tokens.ts refresh logic run against the
// fetch stub; the database is the structural fake from strava-import/testkit.ts.
// What purge_strava_user does to the rows is migration 019's self-test.
import { confirmDisconnect, previewDisconnect, routeDisconnect, type ConfirmDeps } from "./disconnect.ts";
import { connectedSyncStatePatch } from "../strava-oauth-callback/syncState.ts";
import { deauthorize, refreshAccessToken } from "../strava-import/client.ts";
import { harness, installStravaHttp, makePurgeDb, type Row, silenceSentry } from "../strava-import/testkit.ts";

const { check, finish } = harness();
const restoreSentry = silenceSentry();

const USER = "11111111-2222-3333-4444-555555555555";
const NOW = Date.parse("2026-08-28T00:00:00Z");

const freshTokens = {
  user_id: USER,
  athlete_id: 7,
  access_token: "live-access",
  refresh_token: "live-refresh",
  expires_at: new Date(NOW + 6 * 3600_000).toISOString(),
  scope: "activity:read_all",
};
const staleTokens = { ...freshTokens, expires_at: new Date(NOW - 60_000).toISOString() };

const purgeOut = (args: Row) => ({
  status: args.p_dry_run ? "would_purge" : "purged",
  reason: args.p_reason,
  dry_run: args.p_dry_run,
  deleted: 2,
  kept: 1,
  restored: 2,
  orphans_unlinked: 1,
  token_removed: true,
  oauth_states_removed: 1,
  sync_state_removed: true,
});

function setup(opts: {
  tokens?: Row | null;
  rpcFails?: (n: string, a: Row) => { code: string } | undefined;
  http?: Parameters<typeof installStravaHttp>[0];
  deauthorizeTimeoutMs?: number;
}) {
  const db = makePurgeDb({
    tokens: opts.tokens === undefined ? freshTokens : opts.tokens,
    rpcResults: { purge_strava_user: purgeOut },
    rpcFails: opts.rpcFails,
  });
  const net = installStravaHttp(opts.http ?? {});
  // Where in the database log each deauthorize happened, to prove ordering.
  const deauthAt: number[] = [];
  const deps: ConfirmDeps = {
    supa: db.supa,
    userId: USER,
    refresh: (rt) => refreshAccessToken("cid", "csecret", rt),
    deauthorize: (token) => {
      deauthAt.push(db.log.length);
      return deauthorize(token, opts.deauthorizeTimeoutMs);
    },
    now: () => NOW,
  };
  return { db, net, deps, deauthAt };
}

const purgeCalls = (db: ReturnType<typeof makePurgeDb>) => db.rpcCalls.filter((c) => c.name === "purge_strava_user");

// ---------------------------------------------------------------------------
console.log("\nCT-01 preview (AC1)");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({});
  const r = await previewDisconnect(deps);
  net.restore();
  const p = purgeCalls(db);
  check("CT-01 preview calls purge_strava_user once, reason disconnect, p_dry_run:true",
    p.length === 1 && p[0].args.p_reason === "disconnect" && p[0].args.p_dry_run === true && p[0].args.p_user_id === USER,
    p);
  check("CT-01 preview makes zero Strava calls", net.calls.length === 0, net.calls);
  check("CT-01 preview makes zero table writes", db.writes().length === 0, db.writes());
  check("CT-01 preview is exactly three integer keys",
    r.ok && Object.keys(r.preview).sort().join() === "toDelete,toKeep,toRestore" &&
      Object.values(r.preview).every((v) => Number.isInteger(v)), r);
  check("CT-01 toKeep counts kept + orphans; toDelete deleted; toRestore restored",
    r.ok && r.preview.toDelete === 2 && r.preview.toKeep === 2 && r.preview.toRestore === 2, r);
}
{
  const { db, net, deps } = setup({ rpcFails: () => ({ code: "XX000" }) });
  const r = await routeDisconnect("disconnect_preview", false, deps);
  net.restore();
  check("CT-01 preview RPC error -> 502 disconnect_preview_failed",
    r?.status === 502 && r.body.error === "disconnect_preview_failed" && db.writes().length === 0, r);
}
{
  const { net, deps } = setup({});
  const r = await routeDisconnect("disconnect_preview", false, deps);
  net.restore();
  check("CT-01 preview 200 body is { ok, preview }",
    r?.status === 200 && r.body.ok === true && Object.keys(r.body).sort().join() === "ok,preview", r);
}

// ---------------------------------------------------------------------------
console.log("\nCT-02 confirm (AC2, AC6, AC7)");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({});
  const r = await routeDisconnect("disconnect", false, deps);
  net.restore();
  check("CT-02 missing confirm -> 400 confirm_required, no RPC, no Strava call",
    r?.status === 400 && r.body.error === "confirm_required" && db.rpcCalls.length === 0 && net.calls.length === 0, r);
}
{
  const { db, net, deps, deauthAt } = setup({ http: { deauthorize: 200 } });
  const r = await routeDisconnect("disconnect", true, deps);
  net.restore();
  const p = purgeCalls(db);
  check("CT-02 confirm calls purge_strava_user once, disconnect, p_dry_run:false",
    p.length === 1 && p[0].args.p_reason === "disconnect" && p[0].args.p_dry_run === false, p);
  check("CT-02 the purge runs BEFORE deauthorize (AC7)",
    deauthAt.length === 1 && db.log.findIndex((c) => c.op === "purge_strava_user") < deauthAt[0], { log: db.log, deauthAt });
  check("CT-02 200 body: the frozen shape with real counts (AC6)",
    r?.status === 200 &&
      JSON.stringify(r.body) ===
        JSON.stringify({ ok: true, disconnected: true, removed: 2, kept: 2, restored: 2, revocation: "revoked" }),
    r);
  check("CT-02 revokedAtStrava is gone from the contract", r !== null && !("revokedAtStrava" in r.body), r);
  check("CT-02 the edge function itself deletes no token row (only the RPC does)",
    !db.log.some((c) => c.table === "strava_tokens" && c.op === "delete"), db.log);
}
{
  const { net, deps } = setup({ http: { deauthorize: 500 } });
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-02 deauthorize 500 -> 200 with revocation 'failed'", r.ok && r.revocation === "failed", r);
}
{
  // A Strava that never answers: cut off by the timeout, reported 'failed'.
  const { net, deps } = setup({ http: { deauthorize: "timeout" }, deauthorizeTimeoutMs: 30 });
  const t0 = Date.now();
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-02 a hanging deauthorize times out -> revocation 'failed'",
    r.ok && r.revocation === "failed" && Date.now() - t0 < 2000, r);
}
{
  const { net, deps } = setup({ http: { deauthorize: "network" } });
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-02 a network failure on deauthorize -> 'failed'", r.ok && r.revocation === "failed", r);
}

// ---------------------------------------------------------------------------
console.log("\nCT-03 purge failure changes nothing (AC3)");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({ rpcFails: (n) => (n === "purge_strava_user" ? { code: "XX000" } : undefined) });
  const r = await routeDisconnect("disconnect", true, deps);
  net.restore();
  check("CT-03 RPC error -> 502 disconnect_failed", r?.status === 502 && r.body.error === "disconnect_failed", r);
  check("CT-03 deauthorize is NOT called", net.of("deauthorize").length === 0, net.calls);
  check("CT-03 no table writes", db.writes().length === 0, db.writes());
}

// ---------------------------------------------------------------------------
console.log("\nCT-04 no usable token (edge cases, AC5)");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({ tokens: null });
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-04 no token row -> purge still runs, revocation 'not_attempted'",
    r.ok && r.revocation === "not_attempted" && purgeCalls(db).length === 1 && net.calls.length === 0, r);
}
{
  // Refresh refused twice: the grant is dead. getFreshAccessToken would delete
  // the row on that path; here the store's remove is a no-op, so only the
  // purge RPC deletes the token, inside its transaction.
  const { db, net, deps } = setup({ tokens: staleTokens, http: { token: "invalid_grant" } });
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-04 a revoked grant -> 'not_attempted', purge runs",
    r.ok && r.revocation === "not_attempted" && purgeCalls(db).length === 1, r);
  check("CT-04 ... and the refresh path did NOT delete the token row (F5)",
    db.state.tokens !== null && !db.log.some((c) => c.table === "strava_tokens" && c.op === "delete"), db.log);
}
{
  const { db, net, deps } = setup({ tokens: staleTokens, http: { token: 503 } });
  const r = await confirmDisconnect(deps);
  net.restore();
  // The grant may still stand: telling the athlete access "had already ended"
  // would be false, so this is 'failed' (the UI sends them to Strava's My Apps).
  check("CT-04 Strava down at refresh -> 'failed', purge still runs",
    r.ok && r.revocation === "failed" && purgeCalls(db).length === 1 && net.of("deauthorize").length === 0, r);
}
{
  // The token read itself throws: the grant's state is unknown -> 'failed'.
  const { db, net, deps } = setup({});
  const r = await confirmDisconnect({
    ...deps,
    store: {
      read: () => Promise.reject(new Error("token read blew up")),
      rotate: () => Promise.resolve(true),
      remove: () => Promise.resolve(),
    },
  });
  net.restore();
  check("CT-04 a throwing token read -> 'failed', purge still runs, no Strava call",
    r.ok && r.revocation === "failed" && purgeCalls(db).length === 1 && net.calls.length === 0, r);
}
{
  // A stale but refreshable token: rotated first (CAS write), then revoked
  // with the FRESH access token.
  const { db, net, deps } = setup({ tokens: staleTokens, http: { token: "ok", deauthorize: 200 } });
  const r = await confirmDisconnect(deps);
  net.restore();
  check("CT-04 a stale token is refreshed, then revoked", r.ok && r.revocation === "revoked", r);
  check("CT-04 ... the rotation was persisted before the purge",
    db.log.findIndex((c) => c.table === "strava_tokens" && c.op === "update") <
      db.log.findIndex((c) => c.op === "purge_strava_user"), db.log);
}

// ---------------------------------------------------------------------------
console.log("\nCT-05 a reconnect cancels the purge (AC11)");
// ---------------------------------------------------------------------------
{
  const p = connectedSyncStatePatch({
    userId: USER,
    athleteId: 7,
    scope: "activity:read_all",
    nowISO: "2026-08-28T00:00:00.000Z",
    backfillFrom: "2026-01-01",
  });
  check("CT-05 purge_due_at, last_run_status and last_error_code are cleared",
    p.purge_due_at === null && p.last_run_status === null && p.last_error_code === null &&
      "purge_due_at" in p && "last_run_status" in p && "last_error_code" in p, p);
  check("CT-05 connected, with the athlete and scope",
    p.connected === true && p.athlete_id === 7 && p.scope === "activity:read_all" && p.disconnected_at === null, p);
  check("CT-05 no cursor or rate-limit key is touched",
    ["backfill_cursor_before", "incremental_after", "backfill_complete", "rate_limit_resets_at", "reconcile_due_at"]
      .every((k) => !(k in p)), p);
}

{
  // AC11 wiring. index.ts calls Deno.serve at module load and pulls supabase-js
  // from jsr.io, so it cannot be imported here; this pins, from its source,
  // that the sync-state upsert is exactly connectedSyncStatePatch's result.
  const src = await Deno.readTextFile(new URL("../strava-oauth-callback/index.ts", import.meta.url));
  check("CT-05 the callback imports connectedSyncStatePatch from ./syncState.ts",
    /import\s*\{[^}]*\bconnectedSyncStatePatch\b[^}]*\}\s*from\s*["']\.\/syncState\.ts["']/.test(src), null);
  const upserts = [...src.matchAll(/\.from\(\s*["']strava_sync_state["']\s*\)\s*\.(\w+)\(\s*(\w+)?/g)];
  check("CT-05 its one strava_sync_state write is an upsert of connectedSyncStatePatch(...)",
    upserts.length === 1 && upserts[0][1] === "upsert" && upserts[0][2] === "connectedSyncStatePatch",
    upserts.map((m) => m[0]));
}

restoreSentry();
finish();
