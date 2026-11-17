// testkit.ts — shared fakes for the #630 suites (deletion_test.ts here, and
// strava-connect/test.ts). Same approach as the runImport fakes in test.ts:
// a structural Supabase client recording every call IN ORDER, and a
// globalThis.fetch stub so the real client.ts runs. Deduplicating test.ts's own
// fakes onto these is parked (out of scope for #630).

export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The harness — the same hand-rolled one test.ts uses.
// ---------------------------------------------------------------------------

export function harness() {
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
  const finish = () => {
    console.log("\nRESULT:", pass, "passed,", fail, "failed");
    if (fail) Deno.exit(1);
  };
  return { check, finish, counts: () => ({ pass, fail }) };
}

/**
 * Sentry must stay a no-op in a test: captureFunctionError with a DSN set would
 * reach for the network. Returns a restore function.
 */
export function silenceSentry(): () => void {
  const saved = Deno.env.get("SENTRY_DSN");
  Deno.env.delete("SENTRY_DSN");
  return () => {
    if (saved === undefined) Deno.env.delete("SENTRY_DSN");
    else Deno.env.set("SENTRY_DSN", saved);
  };
}

// ---------------------------------------------------------------------------
// makePurgeDb — the Supabase surface the deletion paths use.
// ---------------------------------------------------------------------------

export type Filter = [string, unknown[]];
export type DbCall = { table: string; op: string; payload?: unknown; cols?: string; filters: Filter[] };

export type PurgeDbOpts = {
  /** strava_sync_state rows. A select with no maybeSingle returns those matching eq/lte filters. */
  syncRows?: Row[];
  /** The one strava_tokens row, or null. */
  tokens?: Row | null;
  /** Data an RPC returns, by name: a value or a function of its args. */
  rpcResults?: Record<string, unknown | ((args: Row) => unknown)>;
  /** Return an error object to make this RPC fail. */
  rpcFails?: (name: string, args: Row, range?: [number, number]) => { code: string } | undefined;
  /** Make every write to this table fail. */
  writeFails?: string;
};

export function makePurgeDb(opts: PurgeDbOpts = {}) {
  const log: DbCall[] = [];
  const rpcCalls: { name: string; args: Row; range?: [number, number] }[] = [];
  const state = {
    syncRows: (opts.syncRows ?? []).map((r) => ({ ...r })),
    tokens: opts.tokens === undefined ? null : opts.tokens ? { ...opts.tokens } : null,
  };

  const matches = (row: Row, filters: Filter[]): boolean =>
    filters.every(([m, args]) => {
      const [col, val] = args as [string, unknown];
      if (m === "eq") return row[col] === val;
      if (m === "lte") return row[col] != null && String(row[col]) <= String(val);
      if (m === "lt") return row[col] != null && String(row[col]) < String(val);
      return true;
    });

  const settle = (rec: DbCall, single: boolean) => {
    if (opts.writeFails === rec.table && rec.op !== "select") {
      return { data: null, error: { code: "XX000" } };
    }
    if (rec.table === "strava_sync_state") {
      if (rec.op === "select") {
        const hit = state.syncRows.filter((r) => matches(r, rec.filters));
        return { data: single ? hit[0] ?? null : hit, error: null };
      }
      if (rec.op === "update") {
        for (const r of state.syncRows.filter((x) => matches(x, rec.filters))) Object.assign(r, rec.payload as Row);
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
        const cas = rec.filters.find((f) => f[0] === "eq" && f[1][0] === "refresh_token");
        if (!state.tokens || state.tokens.refresh_token !== cas?.[1][1]) return { data: [], error: null };
        Object.assign(state.tokens, rec.payload as Row);
        return { data: [{ user_id: state.tokens.user_id ?? "u" }], error: null };
      }
    }
    return { data: null, error: null };
  };

  const builder = (table: string, op: string, payload?: unknown, cols?: string) => {
    const rec: DbCall = { table, op, payload, cols, filters: [] };
    log.push(rec);
    // deno-lint-ignore no-explicit-any
    const self: any = {
      select: (c?: string) => {
        rec.cols = c;
        return self;
      },
      maybeSingle: () => Promise.resolve(settle(rec, true)),
      single: () => Promise.resolve(settle(rec, true)),
      // deno-lint-ignore no-explicit-any
      then: (ok: any, bad: any) => Promise.resolve(settle(rec, false)).then(ok, bad),
    };
    for (const m of ["eq", "in", "is", "gte", "lte", "lt", "not", "neq", "order", "limit"]) {
      self[m] = (...args: unknown[]) => {
        rec.filters.push([m, args]);
        return self;
      };
    }
    return self;
  };

  // A bare `await` settles the whole result; `.range(from, to)` (inclusive, as
  // supabase-js) records the range and slices array data; rpcFails sees the range.
  const rpc = (name: string, args: Row) => {
    log.push({ table: "rpc", op: name, payload: args, filters: [] });
    const entry: { name: string; args: Row; range?: [number, number] } = { name, args };
    rpcCalls.push(entry);
    const settle = (range?: [number, number]) => {
      const failure = opts.rpcFails?.(name, args, range);
      if (failure) return { data: null, error: failure };
      const r = opts.rpcResults?.[name];
      const data = typeof r === "function" ? (r as (a: Row) => unknown)(args) : r ?? null;
      return { data: range && Array.isArray(data) ? data.slice(range[0], range[1] + 1) : data, error: null };
    };
    return {
      range: (from: number, to: number) => {
        entry.range = [from, to];
        return Promise.resolve(settle([from, to]));
      },
      // deno-lint-ignore no-explicit-any
      then: (ok: any, bad: any) => Promise.resolve(settle()).then(ok, bad),
    };
  };

  const supa = {
    from: (table: string) => ({
      select: (cols?: string) => builder(table, "select", undefined, cols),
      update: (payload: Row) => builder(table, "update", payload),
      delete: () => builder(table, "delete"),
      insert: (payload: unknown) => builder(table, "insert", payload),
      upsert: (payload: unknown) => builder(table, "upsert", payload),
    }),
    rpc,
  };

  return {
    // deno-lint-ignore no-explicit-any
    supa: supa as any,
    log,
    rpcCalls,
    state,
    /** Every table write (rpc calls excluded). */
    writes: () => log.filter((c) => c.table !== "rpc" && c.op !== "select"),
    syncUpdates: () => log.filter((c) => c.table === "strava_sync_state" && c.op === "update"),
  };
}

// ---------------------------------------------------------------------------
// installStravaHttp — globalThis.fetch, so the real client.ts runs.
// ---------------------------------------------------------------------------

export type DetailStub = Row | number | "timeout" | "network" | "null";

export type StravaHttpStub = {
  /** Activities per page, page 1 first; a page past the end is []. */
  listPages?: Row[][];
  /** Per list call (1-based), a status to answer instead of 200. */
  listStatus?: (call: number) => number | undefined;
  /** Per list call, a raw JSON body to answer with instead of the page (e.g. a non-array). */
  listBody?: (call: number) => unknown;
  detail?: Record<number, DetailStub>;
  deauthorize?: number | "timeout" | "network";
  /** Token endpoint: 'ok' (rotate), 'invalid_grant', or a status. */
  token?: "ok" | "invalid_grant" | number;
  /** x-readratelimit-usage on every response ("short,daily"). */
  usage?: string;
  /** x-readratelimit-limit on every response. */
  limit?: string;
};

export type HttpCall = { kind: "list" | "detail" | "deauthorize" | "token" | "other"; url: string; id?: number };

export function installStravaHttp(stub: StravaHttpStub) {
  const real = globalThis.fetch;
  const calls: HttpCall[] = [];
  const headers = () => ({
    "content-type": "application/json",
    "x-readratelimit-limit": stub.limit ?? "100,1000",
    "x-readratelimit-usage": stub.usage ?? "1,1",
  });
  let listCall = 0;

  // A request that never answers: rejects with the signal's reason (a
  // TimeoutError from AbortSignal.timeout) once the caller's timeout fires.
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_ok, bad) => {
      const s = init?.signal;
      if (!s) return; // no timeout: hangs, which a test would notice
      if (s.aborted) return bad(s.reason);
      s.addEventListener("abort", () => bad(s.reason), { once: true });
    });

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);

    if (url.href.startsWith("https://www.strava.com/oauth/deauthorize")) {
      calls.push({ kind: "deauthorize", url: url.href });
      const d = stub.deauthorize ?? 200;
      if (d === "timeout") return hang(init);
      if (d === "network") return Promise.reject(new TypeError("network down"));
      return Promise.resolve(new Response("{}", { status: d, headers: headers() }));
    }

    if (url.href.startsWith("https://www.strava.com/oauth/token")) {
      calls.push({ kind: "token", url: url.href });
      const mode = stub.token ?? "ok";
      if (mode === "invalid_grant") {
        return Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: headers() }));
      }
      if (typeof mode === "number") return Promise.resolve(new Response("{}", { status: mode, headers: headers() }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 21600,
          }),
          { status: 200, headers: headers() },
        ),
      );
    }

    if (url.pathname === "/api/v3/athlete/activities") {
      listCall++;
      calls.push({ kind: "list", url: url.href });
      const status = stub.listStatus?.(listCall);
      if (status) return Promise.resolve(new Response("[]", { status, headers: headers() }));
      const raw = stub.listBody?.(listCall);
      if (raw !== undefined) return Promise.resolve(new Response(JSON.stringify(raw), { status: 200, headers: headers() }));
      const page = Number(url.searchParams.get("page") ?? 1);
      const body = stub.listPages?.[page - 1] ?? [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: headers() }));
    }

    const m = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      calls.push({ kind: "detail", url: url.href, id });
      const d = stub.detail?.[id];
      if (d === "timeout") return hang(init);
      if (d === "network") return Promise.reject(new TypeError("network down"));
      if (d === "null") return Promise.resolve(new Response("null", { status: 200, headers: headers() }));
      if (typeof d === "number") return Promise.resolve(new Response("{}", { status: d, headers: headers() }));
      if (!d) return Promise.resolve(new Response("{}", { status: 404, headers: headers() }));
      return Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: headers() }));
    }

    calls.push({ kind: "other", url: url.href });
    return Promise.resolve(new Response("{}", { status: 404, headers: headers() }));
  }) as typeof fetch;

  return {
    calls,
    of: (kind: HttpCall["kind"]) => calls.filter((c) => c.kind === kind),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}
