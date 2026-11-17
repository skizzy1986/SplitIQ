// strava-activity test suite (#647). Same hand-rolled harness as
// strava-import/test.ts, run the same way (from supabase/functions):
//
//   deno run --allow-env strava-activity/test.ts
//
// The real client.ts, tokens.ts, importer.ts token store, http.ts shell and
// handler.ts run; the database is a structural fake local to this file and
// Strava is a globalThis.fetch stub. No network, no database, no clock: every
// timestamp derives from NOW. Every id and number below is invented.
import { refreshAccessToken, STREAM_KEYS } from "../strava-import/client.ts";
import { harness, silenceSentry } from "../strava-import/testkit.ts";
import { type ActivityDeps, handleActivityRequest } from "./handler.ts";
import { CORS, serveRequest } from "./http.ts";
import { CACHE_PAYLOAD_VERSION, CACHE_TTL_MS, normaliseActivity, stravaActivityUrl } from "./normalise.ts";

const { check, finish } = harness();
const restoreSentry = silenceSentry();

type Row = Record<string, unknown>;

const USER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const SESSION = 4242;
const ACT = 777000111;
// 00:07 UTC: the next quarter hour is 00:15, the next UTC midnight a day on.
const NOW = Date.parse("2026-08-28T00:07:00Z");
const QUARTER = "2026-08-28T00:15:00.000Z";
const MIDNIGHT = "2026-08-29T00:00:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();

const freshTokens = {
  user_id: USER,
  athlete_id: 7,
  // Distinctive, so SA-09 can prove no token reaches Sentry.
  access_token: "tok-SECRET-9f3a-access",
  refresh_token: "tok-SECRET-9f3a-refresh",
  expires_at: iso(NOW + 6 * 3600_000),
  scope: "activity:read_all",
};
const staleTokens = { ...freshTokens, expires_at: iso(NOW - 60_000) };

// ---------------------------------------------------------------------------
// Fake database: the tables this function touches, with eq/is/lt filters.
// ---------------------------------------------------------------------------
type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][]; opts?: unknown };

function makeDb(init: {
  links?: Row[];
  sync?: Row[];
  cache?: Row[];
  tokens?: Row | null;
  upsertError?: { code: string };
  /** Every strava_sync_state update fails with this. */
  syncUpdateError?: { code: string };
  /** Runs after the sync-state select resolves (simulates a concurrent writer). */
  afterSyncSelect?: (sync: Row[]) => void;
}) {
  const state = {
    links: (init.links ?? []).map((r) => ({ ...r })),
    sync: (init.sync ?? []).map((r) => ({ ...r })),
    cache: (init.cache ?? []).map((r) => ({ ...r })),
    tokens: init.tokens === undefined ? { ...freshTokens } : init.tokens ? { ...init.tokens } : null,
  };
  const log: Call[] = [];
  const tableRows = (t: string): Row[] =>
    t === "strava_session_links"
      ? state.links
      : t === "strava_sync_state"
      ? state.sync
      : t === "strava_activity_cache"
      ? state.cache
      : t === "strava_tokens"
      ? (state.tokens ? [state.tokens] : [])
      : [];

  const match = (row: Row, filters: Call["filters"]) =>
    filters.every(([m, col, val]) => {
      if (m === "eq") return row[col] === val;
      if (m === "is") return row[col] === val || (val === null && row[col] == null);
      if (m === "lt") return row[col] != null && Date.parse(String(row[col])) < Date.parse(String(val));
      return true;
    });

  const settle = (c: Call, single: boolean) => {
    const rows = tableRows(c.table);
    if (c.op === "select") {
      const hit = rows.filter((r) => match(r, c.filters));
      const out = { data: single ? (hit[0] ? { ...hit[0] } : null) : hit, error: null };
      if (c.table === "strava_sync_state") init.afterSyncSelect?.(state.sync);
      return out;
    }
    if (c.op === "delete") {
      if (c.table === "strava_tokens") {
        if (state.tokens && match(state.tokens, c.filters)) state.tokens = null;
      } else {
        const keep = rows.filter((r) => !match(r, c.filters));
        rows.splice(0, rows.length, ...keep);
      }
      return { data: null, error: null };
    }
    if (c.op === "update") {
      if (c.table === "strava_sync_state" && init.syncUpdateError) return { data: null, error: init.syncUpdateError };
      const hit = rows.filter((r) => match(r, c.filters));
      for (const r of hit) Object.assign(r, c.payload as Row);
      return { data: hit.map((r) => ({ user_id: r.user_id })), error: null };
    }
    if (c.op === "upsert") {
      if (init.upsertError) return { data: null, error: init.upsertError };
      const row = c.payload as Row;
      const i = state.cache.findIndex((r) => r.session_id === row.session_id);
      if (i >= 0) state.cache[i] = { ...row };
      else state.cache.push({ ...row });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };

  const builder = (table: string, op: string, payload?: unknown, opts?: unknown) => {
    const c: Call = { table, op, payload, filters: [], opts };
    log.push(c);
    // deno-lint-ignore no-explicit-any
    const self: any = {
      select: () => self,
      maybeSingle: () => Promise.resolve(settle(c, true)),
      // deno-lint-ignore no-explicit-any
      then: (ok: any, bad: any) => Promise.resolve(settle(c, false)).then(ok, bad),
    };
    for (const m of ["eq", "is", "lt"]) {
      self[m] = (col: string, val: unknown) => {
        c.filters.push([m, col, val]);
        return self;
      };
    }
    return self;
  };

  const supa = {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      delete: () => builder(table, "delete"),
      update: (p: Row) => builder(table, "update", p),
      upsert: (p: Row, o?: unknown) => builder(table, "upsert", p, o),
    }),
  };
  return {
    // deno-lint-ignore no-explicit-any
    supa: supa as any,
    state,
    log,
    writes: (table: string) => log.filter((c) => c.table === table && c.op !== "select"),
  };
}

// ---------------------------------------------------------------------------
// Strava stub.
// ---------------------------------------------------------------------------
/** A JSON value; a status; "timeout"; or `{ raw }`, a 200 whose body is that text verbatim. */
type Answer = Row | unknown[] | number | "timeout" | { raw: string };
type HttpStub = {
  detail?: Answer;
  streams?: Answer;
  /** Token endpoint: rotate ('ok', the default), 'invalid_grant', or a status. */
  token?: "ok" | "invalid_grant" | number;
  usage?: string;
  limit?: string;
};
type HttpCall = { kind: string; url: URL; init?: RequestInit; body?: string };

function installHttp(stub: HttpStub) {
  const real = globalThis.fetch;
  const calls: HttpCall[] = [];
  const headers = () => ({
    "content-type": "application/json",
    "x-readratelimit-limit": stub.limit ?? "100,1000",
    "x-readratelimit-usage": stub.usage ?? "1,1",
  });
  const answer = (a: Answer | undefined): Promise<Response> => {
    // What AbortSignal.timeout rejects with, delivered at once so no test waits.
    if (a === "timeout") return Promise.reject(new DOMException("timed out", "TimeoutError"));
    if (typeof a === "number") return Promise.resolve(new Response("{}", { status: a, headers: headers() }));
    if (a && typeof a === "object" && !Array.isArray(a) && typeof (a as { raw?: unknown }).raw === "string") {
      return Promise.resolve(new Response((a as { raw: string }).raw, { status: 200, headers: headers() }));
    }
    return Promise.resolve(new Response(JSON.stringify(a ?? {}), { status: 200, headers: headers() }));
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.href.startsWith("https://www.strava.com/oauth/token")) {
      calls.push({ kind: "token", url, init, body: typeof init?.body === "string" ? init.body : undefined });
      if (stub.token === "invalid_grant") {
        return Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: headers() }));
      }
      if (typeof stub.token === "number") {
        return Promise.resolve(new Response("{}", { status: stub.token, headers: headers() }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "tok-SECRET-fresh-access", refresh_token: "fresh-refresh", expires_at: Math.floor(NOW / 1000) + 21600 }),
          { status: 200, headers: headers() },
        ),
      );
    }
    if (/^\/api\/v3\/activities\/\d+\/streams$/.test(url.pathname)) {
      calls.push({ kind: "streams", url, init });
      return answer(stub.streams);
    }
    if (/^\/api\/v3\/activities\/\d+$/.test(url.pathname)) {
      calls.push({ kind: "detail", url, init });
      return answer(stub.detail);
    }
    calls.push({ kind: "other", url, init });
    return Promise.resolve(new Response("{}", { status: 404, headers: headers() }));
  }) as typeof fetch;
  return {
    calls,
    of: (k: string) => calls.filter((c) => c.kind === k),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures (synthetic).
// ---------------------------------------------------------------------------
const link = (over: Row = {}): Row => ({
  session_id: SESSION,
  user_id: USER,
  strava_activity_id: ACT,
  origin: "inserted",
  device_name: "Concept2 PM5",
  ...over,
});
const connected = (over: Row = {}): Row => ({ user_id: USER, connected: true, rate_limit_resets_at: null, ...over });

const DETAIL: Row = {
  id: ACT,
  name: "Synthetic name that must not be cached",
  description: "synthetic description",
  map: { summary_polyline: "abc" },
  start_latlng: [1.5, 2.5],
  end_latlng: [1.6, 2.6],
  segment_efforts: [{ id: 1 }],
  photos: { count: 1 },
  athlete: { id: 7 },
  gear: { id: "g1" },
  sport_type: "Rowing",
  device_name: "Concept2 PM5",
  elapsed_time: 125,
  moving_time: 120,
  distance: 503.46,
  total_elevation_gain: 0,
  calories: 41.2,
  device_watts: true,
  laps: [
    { start_index: 0, end_index: 2, elapsed_time: 2, moving_time: 2, distance: 9.04, name: "Lap 1" },
    { start_index: 2, end_index: 3, elapsed_time: 1, moving_time: 1, distance: 4.5 },
  ],
};

const KEYED = {
  time: { data: [0, 1, 2, 3], original_size: 4, resolution: "high", series_type: "time" },
  distance: { data: [0, 4.04, 9.04, 13.54], original_size: 4 },
  watts: { data: [150.4, 160.6, 155, 149] },
  heartrate: { data: [120.2, 125.7, 130, 131] },
  cadence: { data: [24.4, 25, 25.6, 26] },
  velocity_smooth: { data: [0, 4.04, 5.0, 4.55] },
  moving: { data: [false, true, true, true] },
};
const ARRAY = Object.entries(KEYED).map(([type, s]) => ({ type, ...s }));

function setup(opts: {
  links?: Row[];
  sync?: Row[];
  cache?: Row[];
  tokens?: Row | null;
  http?: HttpStub;
  upsertError?: { code: string };
  syncUpdateError?: { code: string };
  afterSyncSelect?: (sync: Row[]) => void;
}) {
  const db = makeDb({
    links: opts.links ?? [link()],
    sync: opts.sync ?? [connected()],
    cache: opts.cache,
    tokens: opts.tokens,
    upsertError: opts.upsertError,
    syncUpdateError: opts.syncUpdateError,
    afterSyncSelect: opts.afterSyncSelect,
  });
  const net = installHttp(opts.http ?? { detail: DETAIL, streams: KEYED });
  // What would reach Sentry: the function name, the error and the context.
  const captures: { fn: string; message: string; name: string; context: Row }[] = [];
  const deps: ActivityDeps = {
    supa: db.supa,
    refresh: (rt) => refreshAccessToken("cid", "cs", rt),
    now: () => NOW,
    capture: (fn, err, context) => {
      captures.push({ fn, message: String((err as Error)?.message ?? err), name: (err as Error)?.name ?? "", context });
      return Promise.resolve();
    },
  };
  return { db, net, deps, captures };
}

// Every typed outcome is HTTP 200 (C4): asserted on every call through here.
let runCount = 0;
const run = async (deps: ActivityDeps, sessionId = SESSION, userId = USER) => {
  const r = await handleActivityRequest(deps, userId, sessionId);
  runCount++;
  check(`run#${runCount} (${r.body.status}) is HTTP 200`, r.httpStatus === 200, r.httpStatus);
  // `url` belongs to `ok` only.
  if (r.body.status !== "ok") check(`run#${runCount} (${r.body.status}) carries no url`, !("url" in r.body), r.body);
  return r;
};

const userCache = (db: ReturnType<typeof makeDb>, u = USER) => db.state.cache.filter((r) => r.user_id === u);

// A JWT whose payload carries `sub`. The gateway verifies the signature in
// production; jwtSubject.ts only reads the claim.
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bearer = (sub: string | null) => `Bearer x.${b64url(JSON.stringify(sub ? { sub } : { role: "anon" }))}.y`;

const ENV: Record<string, string> = {
  STRAVA_CLIENT_ID: "cid",
  STRAVA_CLIENT_SECRET: "cs",
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const post = (body: unknown, sub: string | null = USER, method = "POST") =>
  new Request("https://example.invalid/functions/v1/strava-activity", {
    method,
    headers: { authorization: bearer(sub), "content-type": "application/json" },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

// ---------------------------------------------------------------------------
console.log("\nSA-01 auth and request (http.ts)");
// ---------------------------------------------------------------------------
{
  const { db, net } = setup({});
  const serveDeps = { env: (k: string) => ENV[k], makeSupa: () => db.supa, now: () => NOW };

  const opt = await serveRequest(new Request("https://example.invalid", { method: "OPTIONS" }), serveDeps);
  const allow = opt.headers.get("access-control-allow-headers") ?? "";
  check("SA-01 OPTIONS is 200", opt.status === 200, opt.status);
  check("SA-01 OPTIONS allows sentry-trace and baggage", allow.includes("sentry-trace") && allow.includes("baggage"), allow);
  check("SA-01 CORS constant carries both too", CORS["Access-Control-Allow-Headers"].includes("baggage"));

  const noSub = await serveRequest(post({ session_id: SESSION }, null), serveDeps);
  check("SA-01 no sub is 401 unauthorized", noSub.status === 401 && (await noSub.json()).error === "unauthorized", noSub.status);
  const bare = await serveRequest(
    new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ session_id: SESSION }) }),
    serveDeps,
  );
  check("SA-01 no bearer is 401", bare.status === 401, bare.status);

  const get = await serveRequest(post(null, USER, "GET"), serveDeps);
  check("SA-01 GET is 405", get.status === 405, get.status);

  for (const bad of [{ session_id: "4242" }, { session_id: 1.5 }, { session_id: 0 }, { session_id: -3 }, {}, [4242], "not json"]) {
    const r = await serveRequest(post(bad), serveDeps);
    const b = await r.json();
    check(`SA-01 body ${JSON.stringify(bad)} is 400 bad_request`, r.status === 400 && b.error === "bad_request", [r.status, b]);
  }

  const missing = await serveRequest(post({ session_id: SESSION }), { ...serveDeps, env: (k: string) => k === "SUPABASE_URL" ? undefined : ENV[k] });
  const mb = await missing.json();
  check("SA-01 missing env is 500 naming the key", missing.status === 500 && mb.missing?.[0] === "SUPABASE_URL", mb);

  const okRes = await serveRequest(post({ session_id: SESSION, activity_id: 1, user_id: OTHER }), serveDeps);
  const ob = await okRes.json();
  check("SA-01 a valid request is 200 ok", okRes.status === 200 && ob.status === "ok", [okRes.status, ob.status]);
  check("SA-01 body activity_id is ignored: Strava URLs use the link's id",
    net.calls.filter((c) => c.kind === "detail" || c.kind === "streams").every((c) => c.url.pathname.includes(`/activities/${ACT}`)) &&
      net.of("detail").length === 1, net.calls.map((c) => c.url.pathname));
  check("SA-01 body user_id is ignored: the link was read for the JWT's user",
    db.log.some((c) => c.table === "strava_session_links" && c.filters.some(([m, col, v]) => m === "eq" && col === "user_id" && v === USER)));
  check("SA-01 response has Cache-Control: no-store", okRes.headers.get("cache-control") === "no-store", okRes.headers.get("cache-control"));
  check("SA-01 response is application/json with CORS",
    okRes.headers.get("content-type") === "application/json" && okRes.headers.get("access-control-allow-origin") === "*");
  check("SA-01 400 also carries no-store", (await serveRequest(post({}), serveDeps)).headers.get("cache-control") === "no-store");

  const throwing = await serveRequest(post({ session_id: SESSION }), {
    ...serveDeps,
    makeSupa: () => ({ from: () => { throw new Error("boom"); } }) as never,
  });
  check("SA-01 an unexpected throw is 502 strava_activity_failed",
    throwing.status === 502 && (await throwing.json()).error === "strava_activity_failed", throwing.status);
  net.restore();
}
{
  // C3: the refresh uses the client id and secret from the env, not a constant.
  const { db, net } = setup({ tokens: staleTokens });
  const env: Record<string, string> = { ...ENV, STRAVA_CLIENT_ID: "env-client-31337", STRAVA_CLIENT_SECRET: "env-secret-31337" };
  const res = await serveRequest(post({ session_id: SESSION }), { env: (k: string) => env[k], makeSupa: () => db.supa, now: () => NOW });
  const form = new URLSearchParams(net.of("token")[0]?.body ?? "");
  check("SA-01 a stale token through serveRequest refreshes and serves ok", res.status === 200 && (await res.json()).status === "ok");
  check("SA-01 ... the refresh carries the env's client id and secret",
    form.get("client_id") === "env-client-31337" && form.get("client_secret") === "env-secret-31337" &&
      form.get("grant_type") === "refresh_token", Object.fromEntries(form));
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-02 link and connection, no Strava call");
// ---------------------------------------------------------------------------
{
  const { net, deps } = setup({ links: [link({ user_id: OTHER })] });
  const r = await run(deps);
  check("SA-02 another user's link is not_linked", r.body.status === "not_linked", r.body);
  check("SA-02 ... with zero fetches", net.calls.length === 0, net.calls.length);
  net.restore();
}
{
  const { net, deps } = setup({ links: [] });
  const r = await run(deps);
  check("SA-02 a missing link is not_linked with zero fetches", r.body.status === "not_linked" && net.calls.length === 0, r.body);
  net.restore();
}
{
  const cacheRows = [
    { session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: {}, fetched_at: iso(NOW), expires_at: iso(NOW + 1000) },
    { session_id: 5, user_id: USER, strava_activity_id: 5, payload: {}, fetched_at: iso(NOW), expires_at: iso(NOW + 1000) },
    { session_id: 6, user_id: OTHER, strava_activity_id: 6, payload: {}, fetched_at: iso(NOW), expires_at: iso(NOW + 1000) },
  ];
  const { db, net, deps } = setup({ sync: [connected({ connected: false })], cache: cacheRows });
  const r = await run(deps);
  check("SA-02 disconnected is not_connected", r.body.status === "not_connected", r.body);
  check("SA-02 ... the user's cache rows are deleted, another user's kept",
    db.state.cache.length === 1 && db.state.cache[0].user_id === OTHER, db.state.cache);
  check("SA-02 ... with zero fetches", net.calls.length === 0);
  net.restore();
}
{
  const { net, deps } = setup({ sync: [] });
  const r = await run(deps);
  check("SA-02 no sync row is not_connected with zero fetches", r.body.status === "not_connected" && net.calls.length === 0, r.body);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-03 cache");
// ---------------------------------------------------------------------------
const cachedPayload = normaliseActivity(DETAIL, KEYED);
{
  const { net, deps } = setup({
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: cachedPayload, fetched_at: iso(NOW - 3600_000), expires_at: iso(NOW + 3600_000) }],
  });
  const r = await run(deps);
  const b = r.body as Row;
  check("SA-03 a fresh row is ok, cached: true", b.status === "ok" && b.cached === true, b.status);
  check("SA-03 ... with zero fetches", net.calls.length === 0, net.calls.length);
  check("SA-03 ... fetched_at/expires_at come from the row",
    b.fetched_at === iso(NOW - 3600_000) && b.expires_at === iso(NOW + 3600_000), [b.fetched_at, b.expires_at]);
  check("SA-03 ... origin and strava_activity_id from the link", b.origin === "inserted" && b.strava_activity_id === ACT);
  check("SA-03 ... a cache hit carries the activity's Strava url", b.url === "https://www.strava.com/activities/777000111", b.url);
  net.restore();
}
{
  const { db, net, deps } = setup({
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: cachedPayload, fetched_at: iso(NOW - 7 * 86400_000), expires_at: iso(NOW - 1) }],
  });
  const r = await run(deps);
  check("SA-03 an expired row refetches", r.body.status === "ok" && (r.body as Row).cached === false && net.of("detail").length === 1, r.body.status);
  const row = db.state.cache[0];
  const span = Date.parse(String(row.expires_at)) - Date.parse(String(row.fetched_at));
  check("SA-03 the upsert's expires_at is within 7 days of fetched_at", span > 0 && span <= 7 * 86400_000 && span === CACHE_TTL_MS, span);
  check("SA-03 ... and is six days exactly, as a literal (518400000 ms)", span === 518400000 && CACHE_TTL_MS === 518400000, span);
  check("SA-03 a fresh fetch carries the activity's Strava url", (r.body as Row).url === "https://www.strava.com/activities/777000111",
    (r.body as Row).url);
  check("SA-03 url is not stored in the cached row or its payload",
    // No URL of any kind in the cache, not only this host.
    !("url" in (row.payload as Row)) && !("url" in row) && !/https?:/i.test(JSON.stringify(row.payload)), row.payload);
  check("SA-03 the cached payload carries the version, the response does not",
    (row.payload as Row).v === CACHE_PAYLOAD_VERSION && !("v" in (r.body as Row)), [(row.payload as Row).v, Object.keys(r.body)]);
  check("SA-03 fetched_at is now", row.fetched_at === iso(NOW), row.fetched_at);
  const up = db.writes("strava_activity_cache").find((c) => c.op === "upsert");
  check("SA-03 the upsert conflicts on session_id", (up?.opts as Row)?.onConflict === "session_id", up?.opts);
  check("SA-03 the cached row carries the link's activity id and the user", row.strava_activity_id === ACT && row.user_id === USER);
  net.restore();
}
{
  const { net, deps } = setup({
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: 123, payload: cachedPayload, fetched_at: iso(NOW), expires_at: iso(NOW + 3600_000) }],
  });
  const r = await run(deps);
  check("SA-03 a row for a different activity id refetches",
    r.body.status === "ok" && (r.body as Row).cached === false && net.of("detail").length === 1, r.body.status);
  net.restore();
}
{
  const { db, net, deps } = setup({ upsertError: { code: "XX000" } });
  const r = await run(deps);
  check("SA-03 an upsert failure other than 23503 still serves ok, cached: false",
    r.body.status === "ok" && (r.body as Row).cached === false && db.state.cache.length === 0, r.body.status);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-04 rate limits");
// ---------------------------------------------------------------------------
{
  const hold = iso(NOW + 600_000);
  const { db, net, deps } = setup({ sync: [connected({ rate_limit_resets_at: hold })] });
  const r = await run(deps);
  check("SA-04 a future hold is rate_limited with retry_at", r.body.status === "rate_limited" && (r.body as Row).retry_at === hold, r.body);
  check("SA-04 ... with no fetch and no write", net.calls.length === 0 && db.writes("strava_sync_state").length === 0);
  net.restore();
}
{
  const { db, net, deps } = setup({ http: { detail: 429, usage: "101,500", limit: "100,1000" } });
  const r = await run(deps);
  check("SA-04 a detail 429 is rate_limited at the quarter hour", r.body.status === "rate_limited" && (r.body as Row).retry_at === QUARTER, r.body);
  check("SA-04 ... the hold is written", db.state.sync[0].rate_limit_resets_at === QUARTER, db.state.sync[0]);
  check("SA-04 ... no streams call", net.of("streams").length === 0);
  check("SA-04 ... nothing cached", db.state.cache.length === 0);
  net.restore();
}
{
  const { db, net, deps } = setup({ http: { detail: 429, usage: "50,1000", limit: "100,1000" } });
  const r = await run(deps);
  check("SA-04 a daily-cap 429 holds until UTC midnight",
    (r.body as Row).retry_at === MIDNIGHT && db.state.sync[0].rate_limit_resets_at === MIDNIGHT, r.body);
  net.restore();
}
{
  const { db, net, deps } = setup({ http: { detail: DETAIL, streams: 429 } });
  const r = await run(deps);
  check("SA-04 a streams 429 is rate_limited and caches nothing",
    r.body.status === "rate_limited" && db.state.cache.length === 0, r.body);
  net.restore();
}
{
  const past = iso(NOW - 3600_000);
  const { db, net, deps } = setup({ sync: [connected({ rate_limit_resets_at: past })], http: { detail: 429 } });
  await run(deps);
  check("SA-04 a past hold is extended", db.state.sync[0].rate_limit_resets_at === QUARTER, db.state.sync[0]);
  net.restore();
}
{
  // Another worker sets a midnight hold between our read and our write: the
  // quarter-hour write must not shorten it.
  const { db, net, deps } = setup({
    http: { detail: 429 },
    afterSyncSelect: (sync) => {
      sync[0].rate_limit_resets_at = MIDNIGHT;
    },
  });
  const r = await run(deps);
  check("SA-04 the hold write never shortens a later hold", db.state.sync[0].rate_limit_resets_at === MIDNIGHT, db.state.sync[0]);
  check("SA-04 ... both writes are conditional (is null / lt X)",
    db.writes("strava_sync_state").length === 2 &&
      db.writes("strava_sync_state").every((c) => c.filters.some(([m]) => m === "is" || m === "lt")), db.writes("strava_sync_state"));
  check("SA-04 ... the answer is still rate_limited", r.body.status === "rate_limited");
  check("SA-04 ... and retry_at is the later hold actually in force", (r.body as Row).retry_at === MIDNIGHT, r.body);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-05 gone and Garmin");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({
    http: { detail: 404 },
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: cachedPayload, fetched_at: iso(NOW - 8 * 86400_000), expires_at: iso(NOW - 1) }],
  });
  const r = await run(deps);
  check("SA-05 a detail 404 is gone", r.body.status === "gone", r.body);
  check("SA-05 ... the cache row is deleted", db.state.cache.length === 0, db.state.cache);
  check("SA-05 ... no streams call", net.of("streams").length === 0);
  net.restore();
}
{
  const { db, net, deps } = setup({
    links: [link({ device_name: "Garmin Edge 530" })],
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: cachedPayload, fetched_at: iso(NOW), expires_at: iso(NOW + 3600_000) }],
  });
  const r = await run(deps);
  check("SA-05 a Garmin link is garmin_attribution_pending", r.body.status === "garmin_attribution_pending", r.body);
  check("SA-05 ... no Strava call at all, and the cache row is deleted", net.calls.length === 0 && db.state.cache.length === 0);
  net.restore();
}
{
  const { db, net, deps } = setup({ http: { detail: { ...DETAIL, device_name: "Garmin Forerunner 265" }, streams: KEYED } });
  const r = await run(deps);
  check("SA-05 a Garmin detail is garmin_attribution_pending", r.body.status === "garmin_attribution_pending", r.body);
  check("SA-05 ... no streams call and nothing cached", net.of("streams").length === 0 && db.state.cache.length === 0);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-06 auth failures and upstream errors");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({ http: { detail: 401 } });
  const r = await run(deps);
  check("SA-06 a detail 401 is auth_failed", r.body.status === "auth_failed", r.body);
  check("SA-06 ... no token-row delete", db.writes("strava_tokens").length === 0 && db.state.tokens !== null);
  check("SA-06 ... no sync-state write", db.writes("strava_sync_state").length === 0);
  check("SA-06 ... nothing cached", db.state.cache.length === 0);
  net.restore();
}
{
  const { db, net, deps } = setup({ http: { detail: DETAIL, streams: 401 } });
  const r = await run(deps);
  check("SA-06 a streams 401 is auth_failed, nothing written",
    r.body.status === "auth_failed" && db.writes("strava_sync_state").length === 0 && db.state.cache.length === 0, r.body);
  net.restore();
}
{
  // Default store (the Supabase one over the fake), stale token, two invalid_grants.
  const { db, net, deps } = setup({ tokens: staleTokens, http: { token: "invalid_grant" } });
  const r = await run(deps);
  check("SA-06 two invalid_grant refreshes are auth_failed", r.body.status === "auth_failed", r.body);
  check("SA-06 ... two refresh attempts were made", net.of("token").length === 2, net.of("token").length);
  check("SA-06 ... remove was never called on the real store (no strava_tokens delete)",
    !db.log.some((c) => c.table === "strava_tokens" && c.op === "delete") && db.state.tokens !== null);
  check("SA-06 ... no detail call", net.of("detail").length === 0);
  check("SA-06 ... no strava_sync_state write", db.writes("strava_sync_state").length === 0, db.writes("strava_sync_state"));
  net.restore();
}
{
  const { db, net, deps } = setup({ tokens: staleTokens });
  const r = await run(deps);
  check("SA-06 a stale token is refreshed and rotated, then ok",
    r.body.status === "ok" && db.state.tokens?.refresh_token === "fresh-refresh" && net.of("token").length === 1, r.body.status);
  net.restore();
}
{
  const { net, deps } = setup({ tokens: null });
  const r = await run(deps);
  check("SA-06 no token row is not_connected", r.body.status === "not_connected" && net.of("detail").length === 0, r.body);
  net.restore();
}
{
  const { net, deps } = setup({ http: { detail: 503 } });
  const r = await run(deps);
  check("SA-06 a detail 503 is upstream_error", r.body.status === "upstream_error", r.body);
  net.restore();
}
{
  const { net, deps } = setup({ http: { detail: DETAIL, streams: 500 } });
  const r = await run(deps);
  check("SA-06 a streams 500 is upstream_error", r.body.status === "upstream_error", r.body);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-07 streams and normalising");
// ---------------------------------------------------------------------------
{
  const { db, net, deps } = setup({});
  const r = await run(deps);
  const s = net.of("streams")[0]?.url;
  const keys = (s?.searchParams.get("keys") ?? "").split(",");
  check("SA-07 the streams URL asks for exactly the seven keys",
    keys.length === 7 && STREAM_KEYS.every((k) => keys.includes(k)), keys);
  check("SA-07 ... with key_by_type=true", s?.searchParams.get("key_by_type") === "true", s?.search);
  check("SA-07 ... and no latlng, altitude, grade_smooth or temp",
    !/latlng|altitude|grade_smooth|temp/.test(s?.search ?? ""), s?.search);
  const b = r.body as Row;
  const text = JSON.stringify(b) + JSON.stringify(db.state.cache[0]?.payload);
  check("SA-07 the response and the cache carry no name, map, latlng, description, segments, photos, athlete or gear",
    !/Synthetic name|summary_polyline|latlng|description|segment_efforts|photos|athlete|gear/.test(text), text.slice(0, 200));
  const st = b.streams as Row;
  check("SA-07 watts rounded to integers", JSON.stringify(st.watts) === "[150,161,155,149]", st.watts);
  check("SA-07 heartrate and cadence rounded", JSON.stringify(st.heartrate) === "[120,126,130,131]" && JSON.stringify(st.cadence) === "[24,25,26,26]", [st.heartrate, st.cadence]);
  check("SA-07 distance and speed to one decimal", JSON.stringify(st.distance) === "[0,4,9,13.5]" && JSON.stringify(st.velocity_smooth) === "[0,4,5,4.6]", [st.distance, st.velocity_smooth]);
  check("SA-07 moving becomes 0/1", JSON.stringify(st.moving) === "[0,1,1,1]", st.moving);
  const a = b.activity as Row;
  check("SA-07 activity fields mapped",
    a.sport_type === "Rowing" && a.device_name === "Concept2 PM5" && a.elapsed_time_s === 125 && a.moving_time_s === 120 &&
      a.distance_m === 503.5 && a.total_elevation_gain_m === 0 && a.calories === 41 && a.device_watts === true, a);
  check("SA-07 laps kept when not downsampled, renamed, name dropped",
    JSON.stringify(a.laps) ===
      JSON.stringify([
        { start_index: 0, end_index: 2, elapsed_time_s: 2, moving_time_s: 2, distance_m: 9 },
        { start_index: 2, end_index: 3, elapsed_time_s: 1, moving_time_s: 1, distance_m: 4.5 },
      ]), a.laps);
  check("SA-07 activity has exactly the contract's keys",
    Object.keys(a).sort().join() === "calories,device_name,device_watts,distance_m,elapsed_time_s,laps,moving_time_s,sport_type,total_elevation_gain_m", Object.keys(a));
  check("SA-07 streams has exactly the contract's keys",
    Object.keys(st).sort().join() === "cadence,distance,heartrate,moving,time,velocity_smooth,watts", Object.keys(st));
  check("SA-07 the top level has exactly the contract's keys",
    Object.keys(b).sort().join() === "activity,cached,expires_at,fetched_at,origin,status,strava_activity_id,streams,url", Object.keys(b));
  check("SA-07 the cache version `v` is not in the response", !("v" in b) && !JSON.stringify(b).includes('"v":'), Object.keys(b));
  check("SA-07 the detail and streams fetches each carry an AbortSignal (the timeout)",
    net.of("detail")[0]?.init?.signal instanceof AbortSignal && net.of("streams")[0]?.init?.signal instanceof AbortSignal);
  net.restore();
}
{
  const p = normaliseActivity({ ...DETAIL, device_watts: false, has_device_watts: false }, KEYED);
  check("SA-07 device_watts false gives watts null", p.streams.watts === null && p.activity.device_watts === false, p.streams.watts);
  const q = normaliseActivity({ ...DETAIL, device_watts: undefined, has_device_watts: true }, KEYED);
  check("SA-07 has_device_watts true keeps watts", Array.isArray(q.streams.watts), q.streams.watts);
}
{
  const p = normaliseActivity(DETAIL, { ...KEYED, heartrate: { data: [1, 2, 3] } });
  check("SA-07 a length-mismatched series is dropped, others kept", p.streams.heartrate === null && Array.isArray(p.streams.cadence), p.streams);
  const q = normaliseActivity(DETAIL, { ...KEYED, cadence: { data: "nope" } });
  check("SA-07 a non-array series is null", q.streams.cadence === null);
  const { time: _t, ...noTime } = KEYED;
  const r = normaliseActivity(DETAIL, noTime);
  check("SA-07 no time stream means every series is null and no laps",
    Object.values(r.streams).every((v) => v === null) && r.activity.laps.length === 0, r.streams);
}
{
  const k = normaliseActivity(DETAIL, KEYED);
  const a = normaliseActivity(DETAIL, ARRAY);
  check("SA-07 keyed and array stream shapes normalise identically", JSON.stringify(k) === JSON.stringify(a), [k.streams, a.streams]);
}
{
  const p = normaliseActivity(DETAIL, { ...KEYED, time: { data: [0, 1, 2, 3], original_size: 4000 } });
  check("SA-07 laps are dropped when the time stream was downsampled", p.activity.laps.length === 0, p.activity.laps);
  const q = normaliseActivity(DETAIL, { ...KEYED, time: { data: [0, 1, 2, 3] } });
  check("SA-07 laps are kept when original_size is absent", q.activity.laps.length === 2, q.activity.laps);
}
{
  const { db, net, deps } = setup({ http: { detail: DETAIL, streams: 404 } });
  const r = await run(deps);
  const st = (r.body as Row).streams as Row;
  check("SA-07 a streams 404 is ok with every stream null",
    r.body.status === "ok" && Object.values(st).every((v) => v === null), r.body);
  check("SA-07 ... and is cached", db.state.cache.length === 1);
  net.restore();
}
{
  const { net, deps } = setup({ http: { detail: DETAIL, streams: ARRAY } });
  const r = await run(deps);
  check("SA-07 the array shape served live matches the keyed one",
    JSON.stringify((r.body as Row).streams) === JSON.stringify(normaliseActivity(DETAIL, KEYED).streams));
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-08 races");
// ---------------------------------------------------------------------------
{
  const { net, deps } = setup({ upsertError: { code: "23503" } });
  const r = await run(deps);
  check("SA-08 an upsert 23503 (link purged mid-request) is not_linked", r.body.status === "not_linked", r.body);
  check("SA-08 ... and returns no data", Object.keys(r.body).join() === "status", Object.keys(r.body));
  net.restore();
}
{
  const { net, deps } = setup({ http: { detail: "timeout" } });
  const r = await run(deps);
  check("SA-08 a detail timeout is upstream_error", r.body.status === "upstream_error", r.body);
  check("SA-08 ... and no streams call", net.of("streams").length === 0);
  check("SA-08 ... the detail fetch was given an AbortSignal", net.of("detail")[0]?.init?.signal instanceof AbortSignal);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-09 a refused grant drops this user's cache, and writes nothing else (B2, C1)");
// ---------------------------------------------------------------------------
// A stale row: present but expired, so the flow reaches the token step.
const staleCache = (u = USER, sid = SESSION): Row => ({
  session_id: sid,
  user_id: u,
  strava_activity_id: ACT,
  payload: cachedPayload,
  fetched_at: iso(NOW - 7 * 86400_000),
  expires_at: iso(NOW - 1),
});
for (
  const [label, opts] of [
    ["token auth_failed (two invalid_grant)", { tokens: staleTokens, http: { token: "invalid_grant" as const } }],
    ["token not_connected (no token row)", { tokens: null }],
    ["detail 401", { http: { detail: 401 } }],
    ["streams 401", { http: { detail: DETAIL, streams: 401 } }],
  ] as const
) {
  const { db, net, deps } = setup({ ...opts, cache: [staleCache(), staleCache(USER, 5), staleCache(OTHER, 6)] });
  const r = await run(deps);
  check(`SA-09 ${label}: answers ${r.body.status}`, r.body.status === "auth_failed" || r.body.status === "not_connected", r.body);
  check(`SA-09 ${label}: no cache row left for the user`, userCache(db).length === 0, db.state.cache);
  check(`SA-09 ${label}: another user's row kept`, userCache(db, OTHER).length === 1);
  check(`SA-09 ${label}: no token-row delete`, !db.log.some((c) => c.table === "strava_tokens" && c.op === "delete"));
  check(`SA-09 ${label}: no strava_sync_state write`, db.writes("strava_sync_state").length === 0, db.writes("strava_sync_state"));
  net.restore();
}
{
  const { db, net, deps, captures } = setup({ tokens: staleTokens, http: { token: 503 } });
  const r = await run(deps);
  check("SA-09 a token-endpoint 503 (not invalid_grant) is upstream_error", r.body.status === "upstream_error", r.body);
  check("SA-09 ... the token row is untouched",
    db.state.tokens?.refresh_token === staleTokens.refresh_token && !db.log.some((c) => c.table === "strava_tokens" && c.op !== "select"));
  check("SA-09 ... no strava_sync_state write", db.writes("strava_sync_state").length === 0);
  check("SA-09 ... no detail call", net.of("detail").length === 0);
  check("SA-09 ... captured at stage token", captures.some((c) => c.context.stage === "token"), captures);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-10 a cache row is trusted only in the current payload shape (B3)");
// ---------------------------------------------------------------------------
for (
  const [label, payload] of [
    ["{}", {}],
    ["wrong version", { ...cachedPayload, v: CACHE_PAYLOAD_VERSION + 1 }],
    ["no version", { activity: cachedPayload.activity, streams: cachedPayload.streams }],
    ["an array", [cachedPayload]],
    ["array streams", { ...cachedPayload, streams: [] }],
    ["null activity", { ...cachedPayload, activity: null }],
  ] as const
) {
  const { db, net, deps } = setup({
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload, fetched_at: iso(NOW), expires_at: iso(NOW + 3600_000) }],
  });
  const r = await run(deps);
  check(`SA-10 a fresh row with payload ${label} is a miss and refetches`,
    r.body.status === "ok" && (r.body as Row).cached === false && net.of("detail").length === 1, [r.body.status, net.calls.length]);
  check(`SA-10 ... and is replaced by a versioned payload`, (db.state.cache[0]?.payload as Row)?.v === CACHE_PAYLOAD_VERSION);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-11 a non-object detail body is never normalised or cached (B4)");
// ---------------------------------------------------------------------------
for (const [label, body] of [["an array", [DETAIL]], ["null", { raw: "null" }], ["a number", { raw: "42" }]] as const) {
  const { db, net, deps, captures } = setup({ http: { detail: body as Answer, streams: KEYED } });
  const r = await run(deps);
  check(`SA-11 a detail body that is ${label} is upstream_error`, r.body.status === "upstream_error", r.body);
  check(`SA-11 ... no streams call, nothing cached, and it is captured`,
    net.of("streams").length === 0 && db.state.cache.length === 0 && captures.length === 1, [net.of("streams").length, db.state.cache.length, captures]);
  net.restore();
}

// ---------------------------------------------------------------------------
console.log("\nSA-12 nothing upstream reaches Sentry (B5)");
// ---------------------------------------------------------------------------
{
  const FRAG = "BODYFRAG-zq81";
  const SECRETS = [freshTokens.access_token, freshTokens.refresh_token, "tok-SECRET", String(ACT), FRAG];
  const leaks = (captures: { fn: string; message: string; name: string; context: Row }[]) =>
    captures.filter((c) => SECRETS.some((s) => (c.message + c.name + JSON.stringify(c.context)).includes(s)));

  const cases: [string, Parameters<typeof setup>[0], string][] = [
    ["detail: malformed 200", { http: { detail: { raw: `{"name":"${FRAG}" ${ACT} tok-SECRET-9f3a-access` }, streams: KEYED } }, "detail"],
    ["detail: HTTP 502", { http: { detail: 502 } }, "detail"],
    ["streams: malformed 200", { http: { detail: DETAIL, streams: { raw: `[${FRAG} ${ACT}` } } }, "streams"],
    ["streams: HTTP 500", { http: { detail: DETAIL, streams: 500 } }, "streams"],
    ["cache write failure", { upsertError: { code: "XX000" } }, "cache_write"],
    ["hold write failure", { http: { detail: 429 }, syncUpdateError: { code: "XX000" } }, "rate_limit_hold"],
  ];
  for (const [label, opts, stage] of cases) {
    const { net, deps, captures } = setup(opts);
    await run(deps);
    check(`SA-12 ${label}: something is captured at stage ${stage}`, captures.some((c) => c.context.stage === stage), captures);
    check(`SA-12 ${label}: no token, activity id or body text in any capture`, leaks(captures).length === 0, leaks(captures));
    check(`SA-12 ${label}: captures carry only userId, sessionId and stage`,
      captures.every((c) => Object.keys(c.context).sort().join() === "sessionId,stage,userId" && c.fn === "strava-activity"), captures);
    net.restore();
  }
  {
    const { net, deps, captures } = setup({ http: { detail: 502 } });
    await run(deps);
    check("SA-12 an HTTP error is captured with its name and status only",
      captures[0]?.message === "strava detail failed: StravaHttpError HTTP 502", captures[0]?.message);
    net.restore();
  }
  {
    const { net, deps, captures } = setup({ http: { detail: { raw: `{${FRAG}` } } });
    await run(deps);
    check("SA-12 a malformed body is captured as its error name only",
      captures[0]?.message === "strava detail failed: SyntaxError", captures[0]?.message);
    net.restore();
  }
}

// ---------------------------------------------------------------------------
console.log("\nSA-13 the activity-page url has one definition");
// ---------------------------------------------------------------------------
{
  check("SA-13 stravaActivityUrl builds the activity page", stravaActivityUrl(123456789) === "https://www.strava.com/activities/123456789",
    stravaActivityUrl(123456789));
  // The cache-hit top level has the same key set as a fresh fetch, url included.
  const { net, deps } = setup({
    links: [link({ origin: "adopted" })],
    cache: [{ session_id: SESSION, user_id: USER, strava_activity_id: ACT, payload: cachedPayload, fetched_at: iso(NOW), expires_at: iso(NOW + 3600_000) }],
  });
  const r = await run(deps);
  const b = r.body as Row;
  check("SA-13 a cache hit has exactly the contract's top-level keys, url included",
    b.cached === true &&
      Object.keys(b).sort().join() === "activity,cached,expires_at,fetched_at,origin,status,strava_activity_id,streams,url", Object.keys(b));
  check("SA-13 ... its url is built from the link's activity id", b.url === stravaActivityUrl(ACT) && b.origin === "adopted", b.url);
  net.restore();
}

restoreSentry();
finish();
