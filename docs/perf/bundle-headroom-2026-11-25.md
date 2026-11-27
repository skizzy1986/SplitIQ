# Bundle headroom spike — 25 November 2026

Timeboxed analysis for #776, on main `93a8a54` (after #772). The budget is not changed. Official figures come from `VITE_SENTRY_DSN=<CI placeholder> npm run build && npm run size`, the same path CI uses. Supporting measurements live in [`bundle-headroom-2026-11-25/`](./bundle-headroom-2026-11-25/).

Scott approved the spike at 10:32 Perth, 25 November 2026: start a headroom spike, and raise the TOTAL ceiling only per PR with his OK (#504).

## Verdict

The dashboard TOTAL ceiling is 433 KB gzip and main measures **432.1 KB**, leaving **0.9 KB** spare. ENTRY is 204.3 / 208 KB (3.7 KB spare). The next feature will fail the size check unless something is taken out.

Two cuts each free a measured **~22 KB** from both ENTRY and TOTAL, and they add cleanly:

| Cut | ENTRY | TOTAL | Visible to Scott? | Risk | Effort |
| --- | ---: | ---: | --- | --- | --- |
| Baseline (main) | 204.3 | 432.1 | — | — | — |
| Reclaim unused Supabase Realtime + Storage | 182.3 (**−22.0**) | 410.1 (**−22.0**) | No | Medium | Medium |
| Drop Sentry `browserTracingIntegration` | 181.6 (**−22.7**) | 409.4 (**−22.7**) | No (loses performance traces) | Medium (policy + gate) | Low |
| Both together | 159.5 (**−44.8**) | 387.3 (**−44.8**) | No, plus the trace trade-off | Medium | Medium |

**Recommendation:** do the Supabase reclaim first, as its own PR, and leave the budget at 433. That leaves about 22.9 KB of TOTAL spare — enough for #730 and a stretch of follow-up work without a #504 raise. Treat dropping Sentry tracing as a separate decision for Scott: it is slightly larger, but the size gate currently *requires* `BrowserTracing` in the entry (#465), so the follow-up must change that invariant and accept losing pageload traces (sampled at 0.1).

Do not lazy-load the native Bluetooth / notification shims to "save" first paint. That cut helps ENTRY (−3.9 KB) but **raises TOTAL by 1.0 KB** to 433.1, which fails the current ceiling.

## What's in the 432.1 KB (and what is not)

`check-bundle-size.mjs` counts only **`.js` and `.css`**. Fonts, images, the squat anatomy stream, and the Spanish catalogs are outside dashboard TOTAL. TOTAL also carves out squat-only JS (gated on their own ceilings) and the dashboard Spanish chunks (`DASH_ES`, 12.4 / 14 KB).

### First paint (ENTRY 204.3 KB)

| Gzip KB | File | What's in it (source-map estimate) |
| ---: | --- | --- |
| 138.1 | `index-*.js` | react-dom ~64.7, Sentry ~47.6 + web-vitals 2.7, query-core ~7.8, BLE shim ~4.6, React ~2.5, Capacitor core ~2.4 |
| 60.9 | `AuthGate-*.js` | supabase-js stack ~53.7 (auth 25.5, **realtime 8.1, phoenix 6.6, storage 5.8**, postgrest 4.3, supabase-js 2.7, functions 0.7) |
| 3.0 | `locale-*.js` | `@lingui/core` |
| 1.6 | `dist-*.js` | `@lingui/react` |
| 0.3 + 0.3 | CSS + tokens | typography `@font-face` rules (not the files) |

### Rest of TOTAL (already lazy, still counted)

| Gzip KB | File | Notes |
| ---: | --- | --- |
| 84.1 | `CartesianChart-*.js` | Recharts + d3 + decimal.js + immer + Redux toolkit |
| 19.2 | `views-*.js` | English views catalog (~10.7) plus shared hooks / Icon |
| 14.8 | `SessionView-*.js` | session page |
| 14.3 | `YAxis-*.js` | more Recharts |
| 12.8 | `StrengthLogger-*.js` | strength logger |
| 10.7 | `ErgLiveView-*.js` | live PM5 view (current screen) |
| 9.1 | `MobileApp-*.js` | mobile shell and tabs |
| 8.4 | `MobileAnalytics-*.js` | includes another 6.2 KB of Recharts (BarChart path; no duplicated modules) |
| 7.0 | `LiveErgSession-*.js` | new live screen (#769), already a lazy chunk |
| … | remaining views | Settings, Erg, Recovery, Mobility, and other tabs, already split |

The Recharts stack across chunks is about **104 KB gzip** (estimate). It is already off the first paint.

Sentry lives in `main`, so it is also on `/squat`'s first paint (SQUAT_ENTRY 170.8 / 173). A tracing cut would free the same 22.7 KB there.

## Fonts (Archivo and IBM Plex Mono)

They were **not added by #769**. Self-hosted Latin subsets landed with the type seam in #287 (the stylesheet still cites #254). #769 only kept using the same faces.

| File | Raw (already woff2) | Gzip-9 |
| --- | ---: | ---: |
| `archivo-var.woff2` | 34.11 KB | 34.14 KB |
| `ibm-plex-mono-500.woff2` | 14.54 KB | 14.56 KB |
| `ibm-plex-mono-600.woff2` | 15.25 KB | 15.28 KB |
| `ibm-plex-mono-700.woff2` | 14.56 KB | 14.58 KB |
| **Total** | **78.46 KB** | **78.56 KB** |

They are imported from `main.jsx` via `fonts.css`, and all four are **precached** by the service worker. They do **not** count toward ENTRY or TOTAL, because `isCountedAsset` is `.js` / `.css` only. Dropping a mono weight would shrink the install and first download, not the CI budget. All three mono weights are referenced (500 as the default measurement face; 600 and 700 in the live interval builder, the live session, and Strength Logger). Archivo is a single variable file for weights 500–700.

Do not start counting fonts against TOTAL without a separate #504 conversation — it would jump the ceiling by ~78 KB overnight and hide the JS problem this spike is for.

## Other questions the spike set out to answer

- **Big dependencies.** In dashboard TOTAL: Recharts stack ~104 KB, Sentry ~47.6 KB (+ 2.7 web-vitals), Supabase ~53.7 KB, react-dom ~64.7 KB (unavoidable), query-core ~11.8 KB across chunks. `three` (~97.5 KB) is only in `SQUAT_3D` (138.4 / 145 KB).
- **Duplicated modules across chunks.** None that matter. Shared libraries already live in shared chunks. The only "duplicates" in the source-map walk were unmapped bytes (minifier preamble), not copied modules.
- **Locales.** English boot copy is tiny and in AuthGate. The English views catalog is ~10.7 KB in the lazy `views-*.js` chunk and counts toward TOTAL (needed for English). Spanish is already a separate `i18n-es-*` pair (12.4 KB) carved into `DASH_ES`, not precached, not in TOTAL.
- **Unused code.** The clear unused JS is Supabase Realtime (`realtime-js` + `phoenix`) and Storage. The app uses `supabase.functions.invoke` (Strava and vitals) and PostgREST; a repo-wide search finds no `.storage` and no `.channel` / Realtime. This matches `docs/i18n/SPEC.md`, which estimated the reclaim at 20–26 KB and left it unmeasured. It is now measured at **22.0 KB**.
- **Icons.** Five inline paths in `components/Icon.jsx` (~0.7 KB in the views chunk). Not a lever.
- **Sentry.** Always initialised on first paint when a DSN is set (`initSentry()` in `main.jsx`). Integrations: `browserTracingIntegration()` plus default error handlers. No replay, no Session Replay. Conservative `tracesSampleRate: 0.1`. The size script refuses a build whose entry lacks the strings `GlobalHandlers` and `BrowserTracing`, so a tracing-off build is currently a red gate even when Sentry error reporting remains.
- **Polyfills.** None in the production graph (`core-js` / `regenerator` are not dependencies).
- **Chunks that could be lazy.** Almost every dashboard view already is (AuthGate, shells, tabs, Session, LiveErgSession, Strength Logger, Recharts). The leftovers on first paint are React, Sentry, QueryClient, AuthGate / supabase, Lingui, theme, and a **static** import of the native Bluetooth shim from `main.jsx` even though it only runs inside `if (Capacitor.isNativePlatform())`. Making that import dynamic was measured (below) and is a net loss for TOTAL.

## Ranked savings

Estimates are labelled. The top three were measured on a throwaway local tree, then reverted. Nothing from those experiments was committed.

| Rank | Saving | KB (TOTAL) | KB (ENTRY) | Risk | Effort | Visible? | Notes |
| ---: | --- | ---: | ---: | --- | --- | --- | --- |
| 1 | Reclaim unused Supabase Realtime + Storage | **−22.0 measured** | **−22.0** | Medium | Medium | No | AuthGate 60.9 → 38.9. Needs a hand-built `createClient` facade so auth headers still reach PostgREST and Functions (`docs/i18n/SPEC.md`). A vite alias to empty stubs was used only to measure. Do not ship the alias. |
| 2 | Drop Sentry browser tracing (keep error reporting) | **−22.7 measured** | **−22.7** | Medium | Low | No | `index` 138.1 → 115.4. Loses pageload / navigation spans. Must change `SENTRY_INIT_MARKERS` in `entry-graph.mjs` and the #465 commentary, or CI will fail with "missing BrowserTracing". Ask Scott first. |
| 3 | Replace or slim Recharts | ~40–90 estimate | 0 (already lazy) | High | High | Yes — every chart | The stack is ~104 KB. A thin canvas / uPlot-style helper could return a large slice. Visual change, wide test surface (Overview, Recovery, Strength, Erg, Session traces, mobile analytics). Not mechanical. |
| 4 | Dynamic-import native BLE + notifications | **+1.0 measured** | **−3.9** | Low | Low | No | Helps ENTRY, **hurts TOTAL** (extra chunk preamble). Do not do this while TOTAL is the constraint. |
| 5 | Subset or drop a mono weight | 0 to the CI budget; ~15 KB raw download if a weight goes | 0 | Medium | Low | Maybe (missing glyphs / slightly different bold) | All three weights are referenced. Fonts are not in TOTAL. |
| 6 | Lazy-load Sentry after first paint | 0 TOTAL | ~25–47 estimate | Medium | Medium | No | Still ships, so TOTAL is unchanged. First-paint errors could be missed. Not useful for the current gate. |
| 7 | Further view splitting | ~0 or a small TOTAL *increase* | small | Low | Low | No | Already well split. Splitting more often raises TOTAL, as #331 documented and experiment 4 confirmed. |

Combined 1 + 2 measured at **−44.8 KB** on both budgets (387.3 TOTAL, 45.7 KB spare at the current 433 ceiling).

## How the measurements were run

Throwaway edits on a dirty local tree, never committed, reverted afterwards. Each run used the CI placeholder DSN and `sourcemap: false`, then `npm run size`.

1. **Supabase.** Temporary Vite aliases pointed `@supabase/realtime-js` and `@supabase/storage-js` at tiny stubs so `createClient` still constructed. Phoenix dropped with Realtime. This is a *size* measurement, not a production design. The follow-up PR should build a facade that only instantiates auth, PostgREST and Functions, with tests that a signed-in session still queries and that `functions.invoke` still fires (Strava connect / sync, vitals-sync).
2. **Sentry tracing.** Removed `browserTracingIntegration()`, `tracePropagationTargets` and `tracesSampleRate` from `utils/sentry.js`. Error reporting and `Sentry.ErrorBoundary` stayed. The size script failed on the `BrowserTracing` marker, as expected; the JSON figures were still written and are the official gzip numbers.
3. **Native shims.** Replaced the static imports in `main.jsx` with `import()` inside the native `if`. ENTRY fell; TOTAL rose and failed the 433 KB gate by 0.1 KB.

Source-map attribution (a local `sourcemap: true` rebuild, not committed; analysed with `source-map-js`, not a committed visualiser) was used only to label *what* sits in each chunk. Vite 8 here uses Rolldown, so `rollup-plugin-visualizer` was not added to the project. Those estimates are in `package-attribution-estimate.json`.

## Recommendation

1. **Leave MAX_TOTAL_GZIP_KB at 433 and MAX_ENTRY_GZIP_KB at 208.** No raise in this spike.
2. **Next PR:** `perf(web): drop unused Supabase Realtime and Storage from the dashboard bundle (#776)`. Expected official result: TOTAL ≈ 410.1, ENTRY ≈ 182.3. No visual change. After it lands, #730's ~0.9 KB and several later features should fit under 433.
3. **Ask Scott before touching Sentry tracing.** If he is happy to keep errors and drop pageload traces, a second PR is a low-code further −22.7 KB, plus a deliberate edit to the #465 `BrowserTracing` invariant.
4. **Do not** lazy-load Capacitor plugins, and **do not** start counting fonts, as a way to "fix" this budget.
5. Park a Recharts replacement until the two 22 KB cuts are in (or declined). It is the only remaining large lever, and it is a product change, not a tidy-up.

## Out of scope / left alone

PRs #730 and #740, and the in-flight build-number (#773) and plan-before-connect (#774) branches, were not touched. No production data, no budget edit, no visualiser committed.
