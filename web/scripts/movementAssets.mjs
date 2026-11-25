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
  budgetKb: 145,
});

// Each tool's public route, its lazy root (RouteRoot's TOOLS) and its gzip
// budgets: entry is its first paint, total the files only the tools reach,
// the scene excluded. Budgets rise only by the #504 procedure. The squat's
// figures (and SCENE's) are the ones check-bundle-size.mjs gates today; their
// dated history moves here when the gate reads this file.
export const MOVEMENTS = freeze([
  {
    id: 'squat',
    title: 'Squat',
    route: '/squat',
    root: 'src/squat/SquatApp.jsx',
    entryBudgetKb: 173,
    totalBudgetKb: 34,
  },
  {
    id: 'row',
    title: 'Row',
    route: '/row',
    root: 'src/row/RowApp.jsx',
    // set from the first measured build in step 5 (#504)
    entryBudgetKb: 0,
    totalBudgetKb: 0,
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
