// The movement tools and their data files, registered once (#756).
// vite.config.js names chunks and configures Workbox from this file,
// check-bundle-size.mjs budgets from it, the Android build strips by it and
// vercel.json is tested against it, so a new movement or data file is one
// entry here rather than an edit in every one of those places.
//
// Plain frozen data and pure helpers with no Node imports, so the Vite config,
// the size gate, the strip script, both Vitest trees and Playwright can all
// import it.

import { I18N_CHUNK_NAME, isTranslatedCatalog } from './i18nChunks.mjs';

// Deep, but only through arrays and plain objects: a RegExp is left as is.
const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach(freeze);
  } else return value;
  return Object.freeze(value);
};

// A module belongs to a movement tool if it lives under one of these. The
// trailing slash matters: /src/rowing/ or /node_modules/threejs-ext/ is not
// tool code.
export const TOOL_DIRS = freeze([
  '/src/squat/',
  '/src/row/',
  '/src/tool/',
  '/src/anatomy/',
  '/src/movements/',
  '/node_modules/three/',
]);

// EVERY module in the chunk must be a tool's. A chunk that mixes in shared
// code is the dashboard's too and must keep its plain, precached name.
export const isToolOnly = (moduleIds) =>
  Array.isArray(moduleIds) &&
  moduleIds.length > 0 &&
  moduleIds.every((id) => TOOL_DIRS.some((dir) => id.includes(dir)));

export const TOOL_PREFIX = 'anatomy-';
// Also every worker's name (vite.config.js `worker`): all workers today are
// the tools'. A dashboard worker would inherit the prefix, be skipped by the
// precache and stripped from the APK; check-bundle-size.mjs's prefix invariant
// fails the build if that happens.
export const TOOL_CHUNK_NAME = 'assets/anatomy-[name]-[hash].js';
export const PLAIN_CHUNK_NAME = 'assets/[name]-[hash].js';

/** The built file names the prefix produces (dist/assets basenames). */
export const TOOL_JS = /^anatomy-[^/]*\.js$/;

/**
 * rolldown output.chunkFileNames, the build's one naming function. The tool
 * rule is checked first; a translated dashboard catalog is named by
 * i18nChunks.mjs.
 */
export const chunkFileNames = ({ moduleIds }) => {
  if (isToolOnly(moduleIds)) return TOOL_CHUNK_NAME;
  if (isTranslatedCatalog(moduleIds)) return I18N_CHUNK_NAME;
  return PLAIN_CHUNK_NAME;
};

// The scene and three.js, shared by every movement and lazy after its data.
export const SCENE = freeze({
  root: 'src/anatomy/scene/createAnatomyScene.js',
  // MAX_SQUAT_3D_GZIP_KB in check-bundle-size.mjs until #756, verbatim:
  // three.js (r187, tree-shaken) + OrbitControls + the anatomy scene and posing
  // maths. Measured 2026-11-04 at 138.0 KB; ~5% headroom, because a
  // three.js bump is the likeliest way this grows and should be noticed.
  budgetKb: 145,
});

// Each tool's public route, its lazy root (RouteRoot's TOOLS) and its gzip
// budgets, which check-bundle-size.mjs gates: entry is its first paint, total
// the tool-only files it reaches, the scene excluded. Budgets rise only by the
// #504 procedure, with a dated comment beside the figure.
export const MOVEMENTS = freeze([
  {
    id: 'squat',
    title: 'Squat',
    route: '/squat',
    root: 'src/squat/SquatApp.jsx',
    // Until #756 these were MAX_SQUAT_ENTRY_GZIP_KB (SQUAT_ENTRY below, now
    // entryBudgetKb) and MAX_SQUAT_TOTAL_GZIP_KB (SQUAT_TOTAL, now
    // totalBudgetKb) in check-bundle-size.mjs, which is "this script" and
    // holds "ENTRY above". Their history, verbatim:
    //
    // Squat tool, measured 2026-11-04 on PR1 (no three.js yet): SQUAT_ENTRY
    // 107.2 KB, SQUAT_TOTAL 18.8 KB. Entry gets the approved +10 KB (117), total
    // +10% (20.7, rounded up to 21). PR2 adds three.js and will raise both
    // deliberately, with its own measured figures.
    //
    // The dashboard's entry moved 144.5 -> 146.1 KB on the same change: RouteRoot
    // plus the AuthGate chunk boundary it introduced. Still inside 150.
    //
    // PR2a (#382) re-measured 2026-11-04 with three.js in. SQUAT_TOTAL now
    // excludes the 3D chunk and carries the new depth/camera controls and hooks:
    // measured 23.6 KB, ceiling +10% (26); 24.0 KB after the Gate-3 fixes (the
    // controls now render, disabled, from first paint). SQUAT_ENTRY 112.7 KB, still
    // inside 117. The dashboard entry measured 146.6 KB (+0.2): RouteRoot's
    // first-visit offline fallback.
    //
    // PR2b-i re-measured 2026-11-05 with the muscle panel in (list, card, legend,
    // region map, bands, slugs, activation maths): SQUAT_TOTAL 27.6 KB after the
    // Gate-3 fix round (27.26 before it). 27.6 + 10% is 30.4; the ceiling is set
    // to 30 rather than 31, which is ~9% and so slightly tighter than the
    // convention allows. Squat total is the LOOSE ceiling
    // by this script's own definition — never precached, CacheFirst at runtime,
    // stripped from the APK — so these bytes are on nobody's first paint. The
    // panel is NOT lazy-loaded to dodge it: the canvas is aria-hidden with
    // tabindex="-1", so the list IS the accessible substitute for the model, and
    // putting it behind a chunk that can fail to fetch would make it the least
    // reliable thing on the page in exactly the situation it exists for.
    //
    // SQUAT_ENTRY is the tight gate and it still passes, at 116.4 of 117 — but
    // that is 0.6 KB spare, measured, and the next change of any size will fail
    // it. Raising it is not this PR's call.
    //
    // PR C (model as hero, docs/squat/HERO_STAGE_SPEC.md) re-measured 2026-11-12:
    // SQUAT_ENTRY 116.6 -> 118.0 KB, SQUAT_TOTAL 27.8 -> 29.2 KB, the dashboard
    // entry unchanged (147.3 -> 147.3). The growth is the docked controls rail, the
    // phone bar's Rep | View | Show disclosure and the transport icons, which
    // replace three stacked cards and the intro's button row. The bundle rule
    // approved by Scott at Gate 2 sets the ceiling to the measured figure plus
    // ~2 KB, rounded to the nearest whole KB: 118.0 + 2 = 120.
    //
    // R11 share-a-view (#439) re-measured 2026-11-12, against PR C's head:
    // SQUAT_ENTRY 118.0 -> 120.2 KB (+2.2), SQUAT_TOTAL 29.2 -> 31.8 KB (+2.6),
    // SQUAT_3D 138.2 -> 138.4 KB. The growth is the URL grammar (cam, hide, heat,
    // the t cap), the pose maths, the Copy link control and its clipboard
    // fallback. The hash parser moved out of utils/squatRoute.js into the tool,
    // so the shared index chunk shrank (91,113 -> 90,755 B) and the dashboard
    // entry dropped 147.3 -> 146.9 KB. Squat-only static code counts against
    // both squat gates, so both were exceeded. Scott's raise rule at R11 Gate 2:
    // the measured figure plus ~2 KB, rounded to the nearest whole KB. Entry 120.2 + 2 =
    // 122; total 31.8 + 2 = 34. The dashboard's 150 is not touched.
    //
    // Raised 122 -> 124 on 2026-11-13 (Scott, Gate 3, i18n PR-1). Measured 122.0
    // KB, 14 bytes under the old ceiling, with no squat feature in the change:
    // main is shared by both products, and it gained src/i18n/lang.js (the
    // language preference and the pre-chunk words RouteRoot's offline message
    // renders) and ROOT_ERROR_TEXT, the root fallback's English and Spanish,
    // pulled in through RouteRoot and ErrorFallback because both render before
    // any product chunk and so cannot use Lingui. Rule: 122.0 + 2 = 124.
    //
    // Re-based 124 -> 173 on 2026-11-15 (Scott, #465), for the same reason as
    // ENTRY above: the Sentry SDK lives in main, shared by both products, and the
    // gate had been measuring a build without it. 122.0 KB without a DSN, 170.8
    // KB with one. Rule: 170.8 + 2 = 172.8, to the nearest whole KB: 173.
    entryBudgetKb: 173,
    totalBudgetKb: 34,
  },
  {
    id: 'row',
    title: 'Row',
    route: '/row',
    root: 'src/row/RowApp.jsx',
    // Set from the first measured build. Scott approved the #504 rule
    // (measured + ~2 KB, rounded to the nearest whole KB) at Gate 2 of #756,
    // and this measured figure and budget at Gate 3 of #756, both on
    // 2026-11-25. Measured 143,303 B, 139.9 KB in the gate's KB of 1,024 B:
    // the shared main chunk, the RowApp placeholder, the CSS and the tokens
    // chunk. 139.9 + 2 = 141.9, to the nearest whole KB: 142. Gate 2's
    // estimate, ~143 -> ~145, was in decimal kB. #760 raises it with the
    // real page.
    entryBudgetKb: 142,
    // Set from the same build. Scott approved the #504 rule at Gate 2 of
    // #756, and this measured figure and budget at Gate 3 of #756, both on
    // 2026-11-25. Measured 1,075 B, 1.05 KB: the RowApp placeholder chunk,
    // the only file only /row reaches. That is 51 B past Gate 2's range of
    // 0.5 to 1.0 KB, because of the placeholder's own markup. 1.05 + 2 =
    // 3.05, to the nearest whole KB: 3. #760 raises it with the real page.
    totalBudgetKb: 3,
  },
]);

// No data file may outgrow this, whatever its own budget: a first visit
// downloads the whole file (the roadmap's 2.3 MB per-file cap, R20).
export const DATA_FILE_CAP_BYTES = 2_300_000;

// Every data file a tool fetches. Each builds to one hashed
// `${stem}-[hash].${ext}` in dist/assets, is never precached, is cached at
// runtime in `cache`, is stripped from the APK and is served with the headers
// vercelRules() lists. `source` is the committed file and `budgetBytes` its
// raw-byte budget (a bin is already gzip). A `pending` dataset names the issue
// that brings it: until then the gate requires that no such file is built.
export const DATASETS = freeze([
  {
    id: 'squat-anatomy',
    stem: 'squat-anatomy',
    ext: 'bin',
    movements: ['squat'],
    cache: 'squat-data',
    source: 'src/squat/assets/squat-anatomy.bin',
    // MAX_SQUAT_DATA_BYTES in check-bundle-size.mjs until #756, verbatim:
    // The stream measured 2,202,168 bytes; 2.3 MB keeps a re-run of the pipeline
    // from quietly doubling every first visit.
    budgetBytes: 2_300_000,
    pending: null,
  },
  {
    id: 'squat-manifest',
    stem: 'squat-manifest',
    ext: 'json',
    movements: ['squat'],
    cache: 'squat-data',
    source: 'src/squat/assets/squat-manifest.json',
    // Set 2026-11-25 (Scott, Gate 2 of #756, "approve all"): the manifest is
    // gated like the bin now that it is registered. Measured 99,892 B; the
    // data rule's proportionate headroom, ~5%, gives 105,000. Its bytes did
    // not change.
    budgetBytes: 105_000,
    pending: null,
  },
  // Plan estimates, not budgets: body about 2.04 MB gzip, motion about
  // 0.65 MB gzip (curves baked per sample), the manifest about 110 KB.
  {
    id: 'anatomy-body',
    stem: 'anatomy-body',
    ext: 'bin',
    movements: ['row'],
    cache: 'anatomy-body',
    source: null,
    budgetBytes: null,
    pending: '#760',
  },
  {
    id: 'row-motion',
    stem: 'row-motion',
    ext: 'bin',
    movements: ['row'],
    cache: 'row-data',
    source: null,
    budgetBytes: null,
    pending: '#760',
  },
  {
    id: 'row-manifest',
    stem: 'row-manifest',
    ext: 'json',
    movements: ['row'],
    cache: 'row-data',
    source: null,
    budgetBytes: null,
    pending: '#760',
  },
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const routeOf = (id) => MOVEMENTS.find((m) => m.id === id).route;

/** A dataset's built file name (a dist/assets basename). */
export const dataPattern = ({ stem, ext }) =>
  new RegExp(`^${escapeRe(stem)}-[^/]+\\.${escapeRe(ext)}$`);

/** Files the web serves and the APK must not carry: tool JS and data files. */
export const isWebOnlyAsset = (name) =>
  TOOL_JS.test(name) || DATASETS.some((d) => dataPattern(d).test(name));

// The exports below are handed to workbox-build, whose option validation
// (ajv with useDefaults) writes defaults into them, so they stay unfrozen.

// Workbox: tool code and data are never precached (every installed dashboard
// would download them on update) and are cached on first use instead. The
// data extensions already sit outside globPatterns; ignoring them by name
// makes that a decision, not an accident.
export const TOOL_GLOB_IGNORES = [
  '**/assets/anatomy-*.js',
  ...DATASETS.map(({ stem, ext }) => `**/assets/${stem}-*.${ext}`),
];

export const TOOL_CODE_ROUTE = {
  // Content-hashed, so cache-first is safe; capped so old builds' chunks age
  // out instead of piling up. The cache keeps its first tool's name: Workbox
  // never deletes a runtime cache it stops naming, so a rename would strand
  // every old entry on every device that opened /squat.
  urlPattern: /\/assets\/anatomy-[^/]+\.js$/,
  handler: 'CacheFirst',
  options: {
    cacheName: 'squat-code',
    expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
    cacheableResponse: { statuses: [200] },
  },
};

// One runtime cache per group of data files. Two versions of each file fit,
// so an update downloads the new file without evicting the one in use.
export const DATA_CACHES = freeze([
  {
    cacheName: 'squat-data',
    urlPattern: /\/assets\/squat-(anatomy|manifest)-.*\.(bin|json)$/,
    maxEntries: 4,
  },
  {
    cacheName: 'anatomy-body',
    urlPattern: /\/assets\/anatomy-body-[^/]+\.bin$/,
    maxEntries: 2,
  },
  {
    cacheName: 'row-data',
    urlPattern: /\/assets\/row-(motion|manifest)-[^/]+\.(bin|json)$/,
    maxEntries: 4,
  },
]);

// Content-hashed and immutable, so cache-first is safe, and a second visit, or
// an offline one, opens without the download.
export const DATA_RUNTIME_ROUTES = DATA_CACHES.map(
  ({ cacheName, urlPattern, maxEntries }) => ({
    urlPattern,
    handler: 'CacheFirst',
    options: {
      cacheName,
      expiration: { maxEntries },
      cacheableResponse: { statuses: [200] },
    },
  })
);

/**
 * What vercel.json must say for the tools: each movement's prefix rewrites
 * its relative asset, icon and service-worker URLs back to the root files,
 * every asset path is immutable, and every bin is served as octet-stream at
 * the root and under each of its movements' prefixes.
 * @returns {{ rewrites: {source: string, destination: string}[],
 *   immutable: string[], octetStream: string[] }}
 */
export function vercelRules() {
  return {
    rewrites: MOVEMENTS.flatMap(({ route }) => [
      { source: `${route}/assets/(.*)`, destination: '/assets/$1' },
      { source: `${route}/icons/(.*)`, destination: '/icons/$1' },
      {
        source: `${route}/(registerSW\\.js|manifest\\.webmanifest)`,
        destination: '/$1',
      },
    ]),
    immutable: [
      '/assets/(.*)',
      ...MOVEMENTS.map(({ route }) => `${route}/assets/(.*)`),
    ],
    octetStream: DATASETS.filter((d) => d.ext === 'bin').flatMap((d) => [
      `/assets/${d.stem}-(.*)\\.bin`,
      ...d.movements.map((id) => `${routeOf(id)}/assets/${d.stem}-(.*)\\.bin`),
    ]),
  };
}

/** A tool chunk's URL, at the root or under any prefix (e2e). */
export const toolChunkUrlPattern = (chunkName) =>
  new RegExp(`\\/assets\\/anatomy-${escapeRe(chunkName)}-[^/]+\\.js$`);

/** A registered data file's URL, at the root or under any prefix (e2e). */
export function dataUrlPattern(datasetId) {
  const dataset = DATASETS.find((d) => d.id === datasetId);
  if (!dataset) throw new Error(`No registered dataset ${datasetId}.`);
  const { stem, ext } = dataset;
  return new RegExp(`\\/assets\\/${escapeRe(stem)}-[^/]+\\.${escapeRe(ext)}$`);
}

/** A name the build could give the dataset's file (tests). */
export const sampleName = ({ stem, ext }) => `${stem}-Ab12Cd34.${ext}`;
