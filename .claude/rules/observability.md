---
paths:
  - "web/src/utils/sentry.js"
  - "web/vercel.json"
  - "web/vite.config.js"
  - "web/scripts/check-bundle-size.mjs"
  - "supabase/functions/**"
---

# Observability and the bundle gate

> Loaded only when a matching file is read or edited (moved out of root `CLAUDE.md` in
> #424). Not doctrine: `doctrine_sha` does not pin this file.

## Sentry — frontend

Org **`splitiq-29`, EU-region** (`https://de.sentry.io`), frontend project
**`erg-dashboard`**. The region matters everywhere: the ingest host is
`*.ingest.de.sentry.io`, `@sentry/vite-plugin` needs `url: 'https://de.sentry.io'` (it
defaults to `sentry.io` and would not find the org), and every Sentry MCP call needs
`regionUrl: 'https://de.sentry.io'`.

| Piece | Where |
|---|---|
| `Sentry.init` + `captureError()` | `web/src/utils/sentry.js` (gated on `VITE_SENTRY_DSN` — no DSN, no-op) |
| Root boundary | `web/src/main.jsx` (`Sentry.ErrorBoundary`) |
| Per-tab boundary | `web/src/App.jsx` — isolates a broken tab **and** reports via `componentDidCatch` |
| Supabase failure sink | `web/src/utils/queryErrorHandlers.js`, wired into the `QueryCache`/`MutationCache` in `main.jsx` |
| Release + source maps | `web/vite.config.js`, on Vercel production builds only |
| CSP allowlist | `web/vercel.json` — `connect-src` **must** include the ingest host |

Two failure modes are silent and have bitten this repo before; check them first when
Sentry looks dark:

1. **CSP.** If `connect-src` in `web/vercel.json` lacks `https://*.ingest.de.sentry.io`,
   every envelope is blocked in the browser and nothing reaches Sentry, DSN or not.
2. **Release mismatch.** The SDK's `release` and the string the plugin uploads artifacts
   under must be identical, or Sentry serves minified frames without erroring. Both
   derive from `sentryRelease` in `web/vite.config.js` — keep it that way.

`browserTracingIntegration()` is **not** a default integration in the browser SDK;
`tracesSampleRate` does nothing without it. A test asserts this.

It has a **blast radius outside Sentry**: `tracePropagationTargets` in
`web/src/utils/sentry.js` includes the Supabase origin, so the SDK attaches
`sentry-trace` and `baggage` to every call to it. Neither header is CORS-safelisted, so
both appear in the preflight. Supabase's own gateway (`/rest`, `/auth`) reflects request
headers and is unaffected, but **every edge function the client calls directly via
`supabase.functions.invoke` must list them in its `Access-Control-Allow-Headers`**, or the
browser fails the preflight and never sends the request — a bare `TypeError: Failed to
fetch` on the client with only the OPTIONS in the edge logs. This silently killed the Coach
tab (#301; that function has since been removed). Today that means `strava-connect`,
`strava-sync` and `vitals-sync` (re-derive with `grep -rn "functions.invoke" web/src`).
Functions nothing in the browser fetches correctly have **no** CORS block: the cron/server
jobs (`vitals-import`, `vitals-import-api`, `strava-import`) and `strava-oauth-callback`,
which is reached by a top-level browser redirect, not a fetch.

Env vars are documented in `web/.env.example`. Runtime (`VITE_SENTRY_DSN`) and build-time
(`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_URL`/`SENTRY_AUTH_TOKEN`) are set in the Vercel
dashboard, not in the repo.

Session Replay is **not** enabled. `Sentry.init` runs at first paint, so the replay
integration would land in the dashboard ENTRY; it is a lazy-loading question
(`Sentry.lazyLoadIntegration`), not a flat impossibility. Measure before deciding.

## Sentry — edge functions

Project **`erg-dashboard-functions`**, separate so the Deno issue stream stays legible
next to the frontend's. Every function reports through
`supabase/functions/_shared/sentry.ts`. Set `SENTRY_DSN` as an Edge Function secret
(Dashboard → Edge Functions → Secrets); without it every export in that module is a
no-op, so local `supabase functions serve` stays silent.

Two rules in that module are load-bearing, not preferences:

- **`defaultIntegrations: false`.** The Deno SDK does not instrument `Deno.serve`, so
  there is no per-request scope, and the edge runtime reuses an isolate across requests.
  Global breadcrumbs and context would leak into the *next* caller's event. Everything
  request-specific goes through `withScope` instead.
- **`await Sentry.flush()` before returning.** The isolate can be frozen the moment the
  Response resolves, discarding anything still queued in the transport.

**Cron + uptime.** The free plan allows one cron monitor and one uptime monitor. The cron
monitor is on `vitals-import` (check-ins emitted from inside the function, since the
scheduler lives outside the repo; the schedule is upserted from `MONITOR_SCHEDULE` in
code). The uptime monitor points at `https://erg-dashboard-eight.vercel.app/`. More
monitors need a plan upgrade.

## Bundle budgets

**Never quote a bundle figure from a doc — re-measure it.** Figures drift, and a stale
one has already mis-scoped work here (#319). `npm run build && npm run size` prints every
current figure and regenerates `web/dist/bundle-size.json`. `npm run size` enforces every
budget inside the **Build** job.

**Build with `VITE_SENTRY_DSN` set before measuring** (#465). `initSentry()` returns
early without a DSN, so the bundler tree-shakes `Sentry.init`, browser tracing and most
of `@sentry/core` out of the shared entry: ~49 KB gzip lighter than what production
(DSN set on Vercel) ships, on both first paints. The CI Build job sets a placeholder DSN
(valid shape, dead project, never a real one); locally, use the command `npm run size`
prints when it refuses a DSN-less build (`sentryInitProblems` in
`web/scripts/entry-graph.mjs`, matched by integration names kept in the minified chunk). The definitions below are in the header of
`web/scripts/check-bundle-size.mjs`, and each ceiling's history is in the dated comments
beside its constant there.

- **ENTRY** — main plus `AuthGate`'s static graph (a *boot key*: lazy behind `RouteRoot`,
  but nothing paints without it) and its CSS: what a dashboard first paint costs, the
  tight ratchet. **Judge a PR on this row.**
- **TOTAL** — every asset except the files only `/squat` reaches and the Spanish
  catalogs. A loose ceiling. Total sits above its pre-split figure and that is not a
  regression: splitting trades a much smaller entry for a slightly larger total
  (per-chunk preamble, shared code landing in more than one chunk). Gating on total
  alone, as the script did until #331, made the check hostile to code-splitting.
- **SQUAT_ENTRY** (main + `SquatApp`'s static graph) and **SQUAT_TOTAL** (squat-only
  files, minus the 3D chunk) are gated separately. Squat-only static code counts against
  both. SQUAT_TOTAL is loose by definition: never precached, `CacheFirst` at runtime,
  stripped from the APK, so those bytes are on nobody's first paint.
- **SQUAT_3D** — files reachable only through `anatomy/scene/createAnatomyScene.js`
  (three.js + the scene).
- **SQUAT_DATA** — caps the anatomy stream (`squat-anatomy-*.bin`, never precached) and
  fails any precached file over Workbox's 2 MiB per-file ceiling.
- **DASH_ES** — the dashboard's Spanish catalogs (boot: `src/locales/es.po`; views:
  `src/locales/views/`, files listed in `VIEWS_SOURCES` in `web/lingui.config.js`), each
  its own `i18n-es-*` chunk, never precached, carved out of TOTAL so a language never
  reads as the dashboard growing. The Spanish is prefetched by the boot path
  (`registerPrefetch` in `src/i18n/dashboard.js`) once Spanish is chosen or booted. The
  Lingui runtime and the English boot catalog are on first paint by design (production
  message descriptors are id-only, so English cannot render without its catalog); the
  views' English rides in the lazy shells' chunk (`App.jsx` and `MobileApp.jsx` import
  `src/i18n/views.js`), so it counts in TOTAL. `src/i18n/lang.js` and the root fallback's
  words sit in the shared `main` chunk, because RouteRoot's offline message and the
  Sentry root fallback render before any product chunk.

The entry set is read from `dist/.vite/manifest.json` (`build.manifest` in
`web/vite.config.js`), the only source that tells a static import from a dynamic one. The
walk is in `web/scripts/entry-graph.mjs` and is unit-tested, because a walk that wrongly
followed `dynamicImports` would report the total as the entry and pass. The size step
also fails on split invariants: the 3D chunk on either first paint; squat-only JS not
equal to the `squat-*` set; `sw.js` precaching an `assets/squat-` or `assets/i18n-` file;
no `index.html` navigation fallback; a Spanish catalog on a first paint; the views
English found in a first-paint file (`catalogTextLeaks`, matched by its words); and a
first paint without the Sentry init path (`sentryInitProblems`, above).

Both shells and every desktop tab are lazy (`AuthGate.jsx`, `App.jsx`), so recharts is
out of first paint. What remains in the entry is React, react-query, Lingui and
`@supabase/supabase-js` — auth is needed before anything can render, so the client
cannot be deferred. `createClient` pulls in `RealtimeClient` unconditionally and nothing
in `src/` uses realtime; reclaiming it means dropping to `auth-js` + `postgrest-js`
directly. That is its own job, the first lever for entry headroom, and **unmeasured** —
measure it before counting on it.

**Squat-only JS is `squat-` prefixed, never precached, and cached at runtime instead** — a
reversal of squat PR1, which precached the tool's then-small chunks. `chunkFileNames` in
`web/vite.config.js` names a chunk `squat-*` only when every module in it is under
`src/squat/`, `src/anatomy/`, `src/movements/` or `three`; Workbox's `globIgnores` skips `assets/squat-*.js`;
a `CacheFirst` `squat-code` rule caches them on first use; the Android build strips
`dist/assets/squat-*`. Dashboard installs do not download them.

The squat muscle list is deliberately **not** lazy-loaded: the canvas is `aria-hidden`
with `tabindex="-1"`, so the list is the model's accessible substitute and must not sit
behind a chunk that can fail to fetch.

The dashboard entry grew when `/squat` arrived (lazy `AuthGate` adds a chunk boundary;
`RouteRoot` resolves the squat theme, canonicalises `/squat/` → `/squat`, and renders the
first-visit offline message). That cost is an approved trade-off (#383), not noise.

### Budgets rise deliberately, never by drift (#504)

No budget is a performance threshold; each is a ratchet against unnoticed creep, and a
feature that earns its bytes may raise one. This applies to every gate: ENTRY, TOTAL,
SQUAT_ENTRY, SQUAT_TOTAL, SQUAT_3D, SQUAT_DATA, DASH_ES and the planned SQUAT_ES. In the PR
that needs the room:

1. Run `npm run build && npm run size` (DSN set, above), then raise the ceiling to the measured figure plus
   ~2 KB, rounded to the nearest whole KB (#493). SQUAT_3D and SQUAT_DATA keep
   proportionate headroom instead (~5% and ~0.1 MB, as their comments in the script do):
   a flat ~2 KB is noise against three.js or the raw anatomy data.
2. Add a dated comment beside the constant in `web/scripts/check-bundle-size.mjs` saying
   what grew and why it is worth it, in that file's style.
3. Quote the before/after `npm run size` output in the PR body. Do not copy the figures
   into any doc.

Scott approves each raise at the PR's Gate 2; raising a ceiling is his call, not an
agent's. A raise is never a side effect of another change, and budgets ratchet down when
the bundle shrinks.

Design rules that keep raises small:

- Heavy content (motion data, 3D, per-variation prose) loads on demand, never in first
  paint.
- Language catalogs and squat-only chunks stay out of the Workbox precache.
- Try the `RealtimeClient` reclaim (above) before raising ENTRY.
