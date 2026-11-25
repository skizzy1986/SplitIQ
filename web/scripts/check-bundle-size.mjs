#!/usr/bin/env node
// Bundle-size budget — fails the build if the production bundle grows past its
// gzipped budgets. Catches accidental bloat (a heavy dep, a lost code-split) as
// code moves around during the refactor. No external deps: reads dist/ and
// gzips each asset with the built-in zlib.
//
// TWO budgets, because they answer different questions.
//
//   ENTRY — what a first paint costs: the entry chunk plus everything it
//   STATICALLY imports, plus that graph's CSS. This is the number a user feels.
//   It is the tight ratchet.
//
//   TOTAL — every emitted asset, whether or not it ships on first paint. A
//   loose ceiling, so a heavy dependency parked behind a lazy route is still
//   noticed rather than free.
//
// Gating only on TOTAL — which this script did until #331 — makes the check
// actively hostile to code-splitting: splitting trades a much smaller entry
// chunk for a slightly larger total (per-chunk preamble, plus shared code that
// now lands in more than one chunk), so a real user-facing win is reported as
// a regression. Measured on this change: lazy-loading the two shells and the
// 14 desktop tabs cut the entry chunk 395.4 -> 134.7 KB (-66%) while adding
// 26.3 KB to the total.
//
// Since the public movement tools (/squat, then /row) joined the bundle there
// are several PRODUCTS behind one entry, so each budget is scoped to one:
//
//   ENTRY / TOTAL         the dashboard. ENTRY walks main + AuthGate (a boot
//                         key: lazy behind RouteRoot, but nothing paints
//                         without it). TOTAL is every asset EXCEPT the files
//                         only the movement tools can reach, walked together
//                         so a chunk two tools share stays theirs.
//   DASH_ES               the dashboard's Spanish catalogs: files reachable
//                         only through src/locales/es.po (boot) or
//                         src/locales/views/es.po (views, i18n Phase 2a).
//                         Fetched by a visitor who chose Spanish, never on
//                         first paint, never precached. Carved out of TOTAL,
//                         like the tools' files, so a language never reads as
//                         "the dashboard grew".
//   <tool> entry          per movement in scripts/movementAssets.mjs: what
//                         its route costs to paint, main + its root's static
//                         graph.
//   <tool> total          the tool-only files its root reaches (its chunk, its
//                         worker, any chunk it shares with another tool), so
//                         the dashboard's shared code is not double-charged,
//                         minus 3D, which has its own line.
//   3D (shared)           three.js and the anatomy scene: the files reachable
//                         only through the scene's lazy import, one budget for
//                         every tool. Fetched after the data, never on a first
//                         paint.
//   Data                  each registered data file, measured raw (a bin is
//                         already gzip): a live one must build to exactly one
//                         file within its budget, a pending one to none. Plus
//                         a check that nothing the service worker precaches
//                         exceeds Workbox's 2 MiB per-file ceiling — above
//                         it, Workbox silently skips the file.
//
// The dashboard's budgets live here. The tools' budgets, the 3D budget and the
// data budgets live in scripts/movementAssets.mjs with their dated history,
// beside the naming rules the build and the Android strip share (#756).
//
// Every budget is a RATCHET against unnoticed creep, not a performance
// threshold: lower it as the bundle shrinks, and raise it only by the
// procedure in "Budgets rise deliberately,
// never by drift" (#504).
//
// Do not quote a size figure from memory or from a doc — it drifts. Run
// `npm run build && npm run size`, or read dist/bundle-size.json, which this
// script regenerates on every run. Build with VITE_SENTRY_DSN set (CI uses a
// placeholder): without it the Sentry SDK is tree-shaken out and the entry is
// ~49 KB lighter than production, so this script refuses to measure it (#465).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  catalogTextLeaks,
  dataFileProblems,
  entryFilesFrom,
  firstPaintLeaks,
  i18nCatalogProblems,
  isCountedAsset,
  movementFiles,
  navigationProblems,
  onlyReachableVia,
  precacheUrls,
  precachedI18n,
  precachedTool,
  prefixMismatch,
  sentryInitProblems,
  toolOnlyFiles,
} from './entry-graph.mjs';
import {
  DATASETS,
  MOVEMENTS,
  SCENE,
  TOOL_JS,
  dataPattern,
  isWebOnlyAsset,
} from './movementAssets.mjs';
import { I18N_JS } from './i18nChunks.mjs';
import { parsePo } from './i18n-review-sheet.mjs';

// Measured 2026-09-03, after #329 landed mathjs removal: entry 134.9 KB,
// total 373.5 KB. Entry gets ~15 KB of headroom — tight, because that is the
// number that matters and a lost split shows up in it immediately (recharts
// alone is 90 KB). Total gets ~26 KB.
//
// Total was 450 while main still carried mathjs. #329 removed ~52 KB, so it is
// ratcheted to 400 here rather than banking the slack, per the note this
// replaces.
//
// Raised 150 -> 157 on 2026-11-13 (Scott, Gate 2, 2026-11-13, i18n PR-1): the
// Lingui runtime and the dashboard's English catalog sit on first paint by
// design (production descriptors are id-only, so English cannot render without
// its catalog). Measured 146.9 -> 155.4 KB: @lingui/core 3.5, the AuthGate
// chunk +3.9 (en.po with 101 messages — the Strava panel's words among them,
// moved out of its lazy chunk — plus the provider, the toggle and the auth
// error map), use-sync-external-store's shim 0.4, the shared tokens module
// 0.3, and main +0.5 (src/i18n/lang.js and the root fallback's words). Rule:
// the measured figure plus ~2 KB, to the nearest whole KB: 155.4 + 2 = 157.
//
// Re-based 157 -> 208 on 2026-11-15 (Scott, #465): not growth, a correction.
// CI built without VITE_SENTRY_DSN, so initSentry()'s early return let the
// bundler drop Sentry.init, browser tracing and most of @sentry/core from the
// shared entry; production (DSN set on Vercel) ships them. The Build job now
// builds with a placeholder DSN and sentryInitProblems() fails a build whose
// first paint lacks the init path. Measured on the same commit: 156.8 KB
// without a DSN, 205.5 KB with one (browser tracing ~22.5 of the 48.7).
// Rule: 205.5 + 2 = 207.5, to the nearest whole KB: 208. TOTAL measured
// 339.3 -> 388.0 KB, still inside 400, so it is not touched.
//
// TOTAL raised 400 -> 413 on 2026-11-18 (Scott, #648, the session page).
// Measured 396.6 -> 411.4 KB with ENTRY unchanged at 204.1: the page is its
// own lazy chunk (SessionView, 10.1 KB: three synced traces, time in zone and
// the source-neutral series maths), and its English words ride in the shells'
// chunk with the rest of the views catalog. Worth it: it is the first screen
// that shows one session, and none of it is on first paint. Rule:
// 411.4 + 2 = 413.4, to the nearest whole KB: 413.
//
// TOTAL raised 413 -> 419 on 2026-11-18 (Scott, at Gate 3, #649 under #504:
// range selection, splits and More detail on the session page). Measured
// 411.4 -> 416.7 KB with ENTRY unchanged at 204.1 and DASH_ES 10.2 -> 10.9:
// the SessionView chunk grows 10.1 -> 14.7 KB (the splits table, the range
// summary, the drag selection and the peak, weighted-power and drift maths),
// all still lazy and none of it on first paint. Rule: 416.7 + 2 = 418.7, to
// the nearest whole KB: 419.
//
// TOTAL raised 419 -> 421 on 2026-11-24 (Scott, at Gate 2, #742: a way
// out of a live session on phone). Measured 418.4 -> 419.1 KB with ENTRY
// unchanged at 204.2: the shared SessionExitBar (back control plus the
// Stay/Leave question) in the MobileApp chunk, ErgLiveView's per-state
// confirm, and five views-catalog strings. Worth it: without it the phone's
// live erg screen is a dead end in a browser tab. Rule: 419.1 + 2 = 421.1, to
// the nearest whole KB: 421.
//
// TOTAL raised 421 -> 425 on 2026-11-25 (Scott approved 425 KB for #696: the
// Android PM5 list; first approved as 419 -> 424 on 2026-11-22, re-measured
// after rebasing onto #742, #765 and #767). Measured 420.4 -> 423.7 KB with
// ENTRY unchanged at 204.3. The growth is the list screen (PM5Picker), the
// scan and connect-by-id service (pm5Scan) and the hook's list state, all in
// the lazy erg chunk and none of it on first paint; the plugin it calls was
// already in the entry for the Web Bluetooth shim. Measured + 2 would round
// to 426; Scott set 425 explicitly, leaving 1.3 KB of headroom.
//
// TOTAL raised 425 -> 433 on 2026-11-25 (Scott, "Ok approved" at 09:42
// Australia/Perth, #768 under #504: wiring the v10 live screen behind the
// Labs beta switch). Measured 431.2 KB with ENTRY unchanged at 204.2. The
// growth is the lazy LiveErgSession chunk (7.0 KB) plus a small ErgLiveView
// seam, none of it on first paint. Measured + ~2 rounds to 433, leaving
// 1.8 KB of headroom.
const MAX_ENTRY_GZIP_KB = 208;
const MAX_TOTAL_GZIP_KB = 433;

// The dashboard's Spanish catalog. Measured 2026-11-13 (i18n PR-1) at 2.8 KB;
// +~2 KB, to the nearest whole KB. It grows with every translated view (Phase 2+), each
// of which raises it deliberately with its own measured figure.
//
// Raised 5 -> 9 on 2026-11-13 (i18n Phase 2a, approved by Scott at Gate 1+2):
// DASH_ES now counts both Spanish dashboard catalogs. The boot catalog is
// unchanged at 2.8 KB; the new views catalog (194 messages: Overview, Calendar,
// Plan, Log, Recovery, their components and the five mobile panes) builds to
// its own i18n-es-* chunk at 4.5 KB. Measured 7.3 KB (7,478 B). Worth it: it
// is the Spanish for every settled view, fetched only by a visitor who chose
// Spanish, never precached. Rule: 7.3 + 2 = 9.3, to the nearest whole KB: 9.
//
// Raised 9 -> 12 on 2026-11-18 (Scott, #648, the session page): the views
// catalog gained the page's Spanish, about 130 messages. Measured 8.0 -> 10.2
// KB. Fetched only by a visitor who chose Spanish, never precached. Rule:
// 10.2 + 2 = 12.2, to the nearest whole KB: 12.
//
// Raised 12 -> 14 on 2026-11-22 (Scott, at Gate 3, #696): the views catalog
// gained the Android PM5 list's Spanish and its five connect errors, 16
// messages. Measured 12.0 KB. Fetched only by a visitor who chose Spanish,
// never precached. Rule: 12.0 + 2 = 14.0, to the nearest whole KB: 14.
const MAX_DASH_ES_GZIP_KB = 14;
const MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;

// main.jsx renders RouteRoot, which lazy-loads the dashboard or one tool.
const DASHBOARD_BOOT = 'src/AuthGate.jsx';
const TOOL_ROOTS = MOVEMENTS.map((m) => m.root);
const DASH_ES_ROOTS = ['src/locales/es.po', 'src/locales/views/es.po'];
// The views catalog's English rides in the lazy shells' chunk (App.jsx and
// MobileApp.jsx import src/i18n/views.js). It has no manifest key, so it is
// kept off first paint by its words: messages only it holds.
const VIEWS_EN = 'src/locales/views/en.po';
const BOOT_EN = 'src/locales/en.po';

const DIST = join(process.cwd(), 'dist');
const ASSET_DIR = join(DIST, 'assets');
const MANIFEST = join(DIST, '.vite', 'manifest.json');

const gzipOf = (relPath) => gzipSync(readFileSync(join(DIST, relPath))).length;

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// ── TOTAL: every emitted .js/.css in dist/assets ──────────────────
function allAssets() {
  let entries;
  try {
    // withFileTypes carries the file-type from this single readdir call, so we
    // never stat-then-read (avoids a TOCTOU file-system race).
    entries = readdirSync(ASSET_DIR, { withFileTypes: true });
  } catch {
    die(
      `${ASSET_DIR} not found — run \`npm run build\` before the size check.`
    );
  }
  return entries
    .filter((e) => e.isFile() && isCountedAsset(e.name))
    .map((e) => ({ file: e.name, gzip: gzipOf(join('assets', e.name)) }))
    .sort((a, b) => b.gzip - a.gzip);
}

// ── ENTRY: the first-paint graph, from the Vite/rolldown manifest ──
// The walk itself lives in entry-graph.mjs, where it is unit-tested — a walk
// that wrongly followed dynamicImports would report the total as the entry
// and still pass, so it needs a check that is not the build.
function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    die(
      `${MANIFEST} not found — the entry budget needs it.
  Either \`npm run build\` has not run, or build.manifest was turned off in
  vite.config.js. Re-enable it; do not fall back to guessing.`
    );
  }
}

// dist-relative on the way in (for gzipping), assets/-relative on the way
// out, so entry rows match the names in the total listing.
const toRow = (file) => ({
  file: file.startsWith('assets/') ? file.slice('assets/'.length) : file,
  gzip: gzipOf(file),
});

function firstPaint(manifest, bootKey) {
  let files;
  try {
    files = entryFilesFrom(manifest, { bootKeys: [bootKey] });
  } catch (error) {
    die(error.message);
  }
  return files.map(toRow).sort((a, b) => b.gzip - a.gzip);
}

function readSw() {
  try {
    return readFileSync(join(DIST, 'sw.js'), 'utf8');
  } catch {
    die('dist/sw.js not found — the precache check needs the PWA build.');
  }
}
const sw = readSw();

// Workbox writes its precache list into sw.js as {url:"…",revision:…}.
function precachedFiles() {
  const urls = precacheUrls(sw);
  if (!urls.length) die('No precache entries found in dist/sw.js.');
  return urls;
}

const manifest = readManifest();
// A tool root that left the manifest would drop out of every figure and pass.
for (const { root } of MOVEMENTS) {
  if (!manifest[root]) die(`Movement root ${root} is not in the manifest.`);
}
const assetName = (f) =>
  f.startsWith('assets/') ? f.slice('assets/'.length) : f;
const counted = (files) => new Set(files.filter(isCountedAsset).map(assetName));
let toolFiles;
let sceneFiles;
let dashEsFiles;
let ownFiles;
try {
  // Every tool root walked as one graph: walked one at a time, a chunk two
  // tools share is reachable from the other tool, so it would land in the
  // dashboard's TOTAL and in no tool's budget.
  toolFiles = counted(toolOnlyFiles(manifest, TOOL_ROOTS));
  sceneFiles = counted(onlyReachableVia(manifest, SCENE.root, 'Scene root'));
  dashEsFiles = new Set(
    DASH_ES_ROOTS.flatMap((root) =>
      onlyReachableVia(manifest, root, 'Dashboard catalog')
        .filter(isCountedAsset)
        .map(assetName)
    )
  );
  ownFiles = MOVEMENTS.map(({ root }) =>
    counted(movementFiles(manifest, root, TOOL_ROOTS))
  );
} catch (error) {
  die(error.message);
}
const everything = allAssets();
// The dashboard's total: nothing moved, nothing exempted — only the files no
// dashboard path can reach are carved out, and they are gated below instead.
const assets = everything.filter(
  (a) => !toolFiles.has(a.file) && !dashEsFiles.has(a.file)
);
const dashEsAssets = everything.filter((a) => dashEsFiles.has(a.file));
const scene3dAssets = everything.filter((a) => sceneFiles.has(a.file));
const entry = firstPaint(manifest, DASHBOARD_BOOT);
const sum = (list) => list.reduce((n, a) => n + a.gzip, 0);
const totalBytes = sum(assets);
const entryBytes = sum(entry);
const scene3dBytes = sum(scene3dAssets);
const dashEsBytes = sum(dashEsAssets);
// Each tool's entry and total. A chunk the tools share counts in every tool
// that reaches it.
const movements = MOVEMENTS.map((m, i) => {
  const entryAssets = firstPaint(manifest, m.root);
  const totalAssets = everything.filter(
    (a) => ownFiles[i].has(a.file) && !sceneFiles.has(a.file)
  );
  return {
    ...m,
    entry: sum(entryAssets),
    entryAssets,
    total: sum(totalAssets),
    totalAssets,
  };
});

// ── Structural invariants of the tool split (entry-graph.mjs) ─────
// Each fails silently if broken: three.js on a first paint costs ~140 KB
// with every budget still green if the ceiling happened to fit; a tool chunk
// without the prefix is precached into every dashboard install; a prefixed
// shared chunk is never precached, so the dashboard breaks offline.
// ASCII-only, long, placeholder-free messages the views catalog holds and the
// boot catalog does not: what a minifier leaves byte for byte in the output.
function viewsEnglishLeaks() {
  const ids = (f) =>
    new Set(
      parsePo(readFileSync(join(process.cwd(), f), 'utf8')).map((e) => e.msgid)
    );
  const boot = ids(BOOT_EN);
  const phrases = [...ids(VIEWS_EN)].filter(
    (m) =>
      !boot.has(m) &&
      m.length >= 24 &&
      /^[\x20-\x7e]+$/.test(m) &&
      !/[{}'"\\]/.test(m)
  );
  const text = (file) => ({
    file: assetName(file),
    text: readFileSync(join(DIST, file), 'utf8'),
  });
  const js = (f) => f.endsWith('.js');
  const firstPaintText = [DASHBOARD_BOOT, ...TOOL_ROOTS].flatMap((key) =>
    entryFilesFrom(manifest, { bootKeys: [key] })
      .filter(js)
      .map(text)
  );
  const allText = readdirSync(ASSET_DIR)
    .filter(js)
    .map((f) => text(join('assets', f)));
  return catalogTextLeaks(
    firstPaintText,
    allText,
    phrases,
    'The views English catalog'
  );
}

// Each product's first-paint JS, as text.
function firstPaintJs(key) {
  return entryFilesFrom(manifest, { bootKeys: [key] })
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      file: assetName(f),
      text: readFileSync(join(DIST, f), 'utf8'),
    }));
}

const invariants = [];
try {
  invariants.push(
    ...sentryInitProblems([
      { name: 'dashboard', files: firstPaintJs(DASHBOARD_BOOT) },
      ...MOVEMENTS.map(({ route, root }) => ({
        name: route,
        files: firstPaintJs(root),
      })),
    ]),
    // No 3D on any first paint.
    ...firstPaintLeaks(manifest, SCENE.root, [DASHBOARD_BOOT, ...TOOL_ROOTS]),
    // No tool code on the dashboard's: a statically imported tool root would
    // still carry the prefix, so the naming check below would not see it.
    ...firstPaintLeaks(manifest, TOOL_ROOTS, [DASHBOARD_BOOT], {
      what: 'movement-tool code',
      fix: 'Lazy-load every tool root from RouteRoot.',
    }),
    // No tool on another's.
    ...MOVEMENTS.flatMap(({ root, title }) =>
      firstPaintLeaks(
        manifest,
        root,
        TOOL_ROOTS.filter((other) => other !== root),
        {
          what: `the ${title} tool`,
          fix: 'Each tool root loads lazily, from RouteRoot only.',
        }
      )
    ),
    ...DASH_ES_ROOTS.flatMap((root) => [
      ...firstPaintLeaks(manifest, root, [DASHBOARD_BOOT, ...TOOL_ROOTS], {
        what: `the Spanish dashboard catalog ${root}`,
        fix: 'Load it only through ensureLocale (src/i18n/locale.js).',
      }),
      ...i18nCatalogProblems(manifest, root, TOOL_ROOTS, I18N_JS),
    ]),
    ...viewsEnglishLeaks(),
    ...prefixMismatch(
      toolOnlyFiles(manifest, TOOL_ROOTS),
      readdirSync(ASSET_DIR),
      TOOL_JS
    ),
    ...navigationProblems(sw)
  );
} catch (error) {
  die(error.message);
}

// The data files are found by name: the worker sub-build emits a bin with no
// record in the manifest.
const data = dataFileProblems(
  DATASETS.map((d) => ({ ...d, pattern: dataPattern(d) })),
  readdirSync(ASSET_DIR),
  (name) => statSync(join(ASSET_DIR, name)).size
);
const precache = precachedFiles()
  .map((url) => ({ url, bytes: statSync(join(DIST, url)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const largestPrecached = precache[0];
invariants.push(
  ...data.problems,
  ...precachedTool(
    precache.map((p) => p.url),
    isWebOnlyAsset
  ),
  ...precachedI18n(precache.map((p) => p.url))
);

// Machine-readable summary for CI reporting (report-bundle-size.mjs diffs it
// against the main-branch baseline). `budgetKb`/`total`/`assets` keep their
// original names and meanings so a baseline cached before #331 still reads,
// and the squat* keys theirs, so one cached before #756 does. Written before
// the budget checks so the PR comment still shows the delta when a gate fails.
const squat = movements.find((m) => m.id === 'squat');
const squatBin = data.files.find((f) => f.id === 'squat-anatomy');
writeFileSync(
  join(DIST, 'bundle-size.json'),
  JSON.stringify(
    {
      budgetKb: MAX_TOTAL_GZIP_KB,
      total: totalBytes,
      assets,
      entryBudgetKb: MAX_ENTRY_GZIP_KB,
      entry: entryBytes,
      entryAssets: entry,
      squatEntryBudgetKb: squat.entryBudgetKb,
      squatEntry: squat.entry,
      squatEntryAssets: squat.entryAssets,
      squatTotalBudgetKb: squat.totalBudgetKb,
      squatTotal: squat.total,
      squatAssets: squat.totalAssets,
      // The shared 3D set: the same files the squat's 3D line measured.
      squat3dBudgetKb: SCENE.budgetKb,
      squat3d: scene3dBytes,
      squat3dAssets: scene3dAssets,
      dashEsBudgetKb: MAX_DASH_ES_GZIP_KB,
      dashEs: dashEsBytes,
      dashEsAssets,
      squatData: {
        file: squatBin.file,
        bytes: squatBin.bytes,
        budgetBytes: squatBin.budgetBytes,
      },
      precacheLargest: largestPrecached,
      precacheFileBudgetBytes: MAX_PRECACHE_FILE_BYTES,
      movements: Object.fromEntries(
        movements.map((m) => [
          m.id,
          {
            title: m.title,
            route: m.route,
            entryBudgetKb: m.entryBudgetKb,
            entry: m.entry,
            entryAssets: m.entryAssets,
            totalBudgetKb: m.totalBudgetKb,
            total: m.total,
            totalAssets: m.totalAssets,
          },
        ])
      ),
      data: data.files.map((f, i) => ({
        id: f.id,
        movements: DATASETS[i].movements,
        file: f.file,
        bytes: f.bytes,
        budgetBytes: f.budgetBytes,
        pending: f.pending,
      })),
    },
    null,
    2
  )
);

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const mb = (b) => `${(b / 1e6).toFixed(3)} MB`;
const entryFiles = new Set(entry.map((a) => a.file));

console.log('Bundle size (gzipped):');
for (const a of assets) {
  const mark = entryFiles.has(a.file) ? '▪' : '·';
  console.log(`  ${mark} ${kb(a.gzip).padStart(10)}  ${a.file}`);
}
console.log(`    ${'─'.repeat(10)}`);
for (const a of dashEsAssets) {
  console.log(`  ◦ ${kb(a.gzip).padStart(10)}  ${a.file}  (es)`);
}
console.log(
  `  ▪ ${kb(entryBytes).padStart(10)}  entry  (budget ${MAX_ENTRY_GZIP_KB} KB) — ships on first paint`
);
console.log(
  `    ${kb(totalBytes).padStart(10)}  total  (budget ${MAX_TOTAL_GZIP_KB} KB) — everything the dashboard can reach, Spanish excluded`
);
console.log(
  `    ${kb(dashEsBytes).padStart(10)}  dash es  (budget ${MAX_DASH_ES_GZIP_KB} KB) — both Spanish catalogs, fetched only on choosing it, not precached`
);
console.log('\nMovement tools (gzipped):');
for (const m of movements) {
  for (const a of m.totalAssets) {
    console.log(`  · ${kb(a.gzip).padStart(10)}  ${a.file}`);
  }
  console.log(`    ${'─'.repeat(10)}`);
  console.log(
    `    ${kb(m.entry).padStart(10)}  ${m.id} entry  (budget ${m.entryBudgetKb} KB) — first paint of ${m.route}`
  );
  console.log(
    `    ${kb(m.total).padStart(10)}  ${m.id} total  (budget ${m.totalBudgetKb} KB) — tool files ${m.route} reaches, 3D excluded`
  );
}
for (const a of scene3dAssets) {
  console.log(`  ◦ ${kb(a.gzip).padStart(10)}  ${a.file}  (3D)`);
}
console.log(`    ${'─'.repeat(10)}`);
console.log(
  `    ${kb(scene3dBytes).padStart(10)}  3D (shared)  (budget ${SCENE.budgetKb} KB) — three.js + scene, lazy after the data`
);
console.log('\nData (raw, not precached):');
for (const f of data.files) {
  const figure = f.bytes === null ? '' : mb(f.bytes);
  const detail = f.pending
    ? `pending (${f.pending})`
    : `(budget ${mb(f.budgetBytes)}) — ${f.file ?? 'not exactly one file, see below'}`;
  console.log(`    ${figure.padStart(10)}  ${f.id}  ${detail}`);
}
console.log(
  `    ${mb(largestPrecached.bytes).padStart(10)}  largest precached file (ceiling 2 MiB) — ${largestPrecached.url}`
);

const failures = [];
for (const [label, bytes, budgetKb, advice] of [
  [
    'Entry chunk',
    entryBytes,
    MAX_ENTRY_GZIP_KB,
    'Lazy-load a route or trim a dependency that first paint does not need, or raise MAX_ENTRY_GZIP_KB deliberately (#504).',
  ],
  [
    'Total',
    totalBytes,
    MAX_TOTAL_GZIP_KB,
    'Trim a dependency, or raise MAX_TOTAL_GZIP_KB deliberately (#504).',
  ],
  ...movements.flatMap((m) => [
    [
      `${m.title} entry`,
      m.entry,
      m.entryBudgetKb,
      `Something ${m.route} statically imports grew — keep heavy pieces behind a lazy import, or raise its entryBudgetKb in scripts/movementAssets.mjs deliberately (#504).`,
    ],
    [
      `${m.title} total`,
      m.total,
      m.totalBudgetKb,
      'Trim the tool, or raise its totalBudgetKb in scripts/movementAssets.mjs deliberately (#504).',
    ],
  ]),
  [
    'Dashboard Spanish catalog',
    dashEsBytes,
    MAX_DASH_ES_GZIP_KB,
    'A dashboard es.po grew — raise MAX_DASH_ES_GZIP_KB deliberately with the measured figure.',
  ],
  [
    '3D (shared)',
    scene3dBytes,
    SCENE.budgetKb,
    'three.js or the scene grew — check for a non-tree-shaken import (three/addons barrel, `import *`), or raise SCENE.budgetKb in scripts/movementAssets.mjs deliberately (#504).',
  ],
]) {
  if (bytes > budgetKb * 1024) {
    failures.push(
      `✖ ${label} is ${(bytes / 1024 - budgetKb).toFixed(1)} KB over the ${budgetKb} KB gzipped budget.\n  ${advice}`
    );
  }
}

for (const p of precache.filter((f) => f.bytes > MAX_PRECACHE_FILE_BYTES)) {
  failures.push(
    `✖ ${p.url} is precached at ${p.bytes} bytes, over Workbox's 2 MiB per-file ceiling — it would be skipped silently.\n  Add it to globIgnores in vite.config.js and cache it at runtime instead.`
  );
}

failures.push(...invariants.map((m) => `✖ ${m}`));

if (failures.length) {
  console.error(`\n${failures.join('\n')}`);
  process.exit(1);
}

const spare = (budgetKb, bytes) => `${(budgetKb - bytes / 1024).toFixed(1)} KB`;
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const spares = [
  `entry ${spare(MAX_ENTRY_GZIP_KB, entryBytes)}`,
  `total ${spare(MAX_TOTAL_GZIP_KB, totalBytes)}`,
  ...movements.flatMap((m) => [
    `${m.id} entry ${spare(m.entryBudgetKb, m.entry)}`,
    `${m.id} total ${spare(m.totalBudgetKb, m.total)}`,
  ]),
  `3D (shared) ${spare(SCENE.budgetKb, scene3dBytes)}`,
  `dash es ${spare(MAX_DASH_ES_GZIP_KB, dashEsBytes)}`,
  ...data.files
    .filter((f) => !f.pending)
    .map((f) => `${f.id} ${thousands(f.budgetBytes - f.bytes)} B`),
];
console.log(`\n✓ Within budget (${spares.join(' spare, ')} spare).`);
