// The first-paint graph, derived from a Vite/rolldown build manifest.
//
// Split out from check-bundle-size.mjs so it can be tested directly: this walk
// is the load-bearing claim of the entry budget, and the way it fails is
// silent. Follow `dynamicImports` by mistake and the "entry" number quietly
// becomes the total again — every chunk reachable, budget passing, gate
// meaningless. A wrong number here does not throw.

/** A file counts toward a byte budget if it is JS or CSS. */
export const isCountedAsset = (name) =>
  name.endsWith('.js') || name.endsWith('.css');

/**
 * Files the browser must download before it can paint: every entry chunk, its
 * transitively STATIC imports, and that graph's CSS.
 *
 * `imports` is followed. `dynamicImports` is not — those chunks are fetched on
 * demand, which is the entire point of a code split. Nothing in the emitted
 * filenames distinguishes the two, which is why build.manifest is switched on
 * in vite.config.js rather than the distinction being guessed.
 *
 * `bootKeys` are extra roots walked the same way — statically only. They name
 * a chunk the entry loads lazily but that first paint cannot happen without:
 * main.jsx imports AuthGate behind RouteRoot so /squat can skip it, but the
 * dashboard cannot paint a pixel until AuthGate (and supabase-js with it) has
 * arrived. Leaving it out would let the dashboard's real first-paint cost
 * escape the budget through the very split that made /squat light. Their own
 * dynamicImports are still not followed.
 *
 * @param {Record<string, object>} manifest parsed .vite/manifest.json
 * @param {{ bootKeys?: string[] }} [options]
 * @returns {string[]} dist-relative paths, deduped, in discovery order
 */
export function entryFilesFrom(manifest, { bootKeys = [] } = {}) {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry);
  if (entries.length === 0) {
    throw new Error('No isEntry record in the manifest.');
  }
  for (const key of bootKeys) {
    // A renamed boot chunk would otherwise drop out silently and the entry
    // figure would fall by its whole size — a pass that measures less.
    if (!manifest[key])
      throw new Error(`Boot key ${key} is not in the manifest.`);
  }
  const roots = [...entries, ...bootKeys];

  const files = new Set();
  // `seen` guards a genuine cycle, not a theoretical one: a lazy chunk
  // statically imports back into the entry record, so an unguarded walk of a
  // real manifest never terminates.
  const seen = new Set();
  const queue = [...roots];

  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);

    const record = manifest[key];
    if (!record) continue;

    if (record.file && isCountedAsset(record.file)) files.add(record.file);
    for (const css of record.css ?? []) files.add(css);
    for (const imported of record.imports ?? []) queue.push(imported);
  }

  return [...files];
}

/**
 * Every file reachable from `roots`, following static AND dynamic imports and
 * each record's emitted `assets` (where Vite lists a worker chunk and `?url`
 * files). `stopAt` keys are never entered — that is how one product's graph is
 * walked without wandering into the other's through the shared entry.
 *
 * @param {Record<string, object>} manifest
 * @param {string[]} roots manifest keys
 * @param {{ stopAt?: string[] }} [options]
 * @returns {Set<string>} dist-relative paths
 */
export function reachableFiles(manifest, roots, { stopAt = [] } = {}) {
  const files = new Set();
  const seen = new Set(stopAt);
  const queue = [...roots];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    const record = manifest[key];
    if (!record) continue;
    if (record.file) files.add(record.file);
    for (const f of [...(record.css ?? []), ...(record.assets ?? [])]) {
      files.add(f);
    }
    for (const k of [
      ...(record.imports ?? []),
      ...(record.dynamicImports ?? []),
    ]) {
      queue.push(k);
    }
  }
  return files;
}

const entryKeys = (manifest) =>
  Object.keys(manifest).filter((key) => manifest[key]?.isEntry);

/**
 * Files reachable through any of `viaKeys` and by no other route from the
 * entry: everything reachable from them, minus anything the entries reach
 * when walked without entering any of them. Shared code stays with whoever
 * else reaches it; code only the via roots share stays with them.
 *
 * @param {Record<string, object>} manifest
 * @param {string[]} viaKeys manifest keys of the root modules
 * @param {string} [what] how to name a key in the error
 * @returns {string[]} dist-relative paths
 */
export function onlyReachableViaAny(manifest, viaKeys, what = 'Root') {
  // An empty list would measure nothing and pass: the silent failure above.
  if (!viaKeys.length) throw new Error(`No ${what} key given.`);
  for (const key of viaKeys) {
    if (!manifest[key])
      throw new Error(`${what} ${key} is not in the manifest.`);
  }
  const others = reachableFiles(manifest, entryKeys(manifest), {
    stopAt: viaKeys,
  });
  const via = reachableFiles(manifest, viaKeys);
  return [...via].filter((f) => !others.has(f));
}

/**
 * {@link onlyReachableViaAny} for one root.
 *
 * @param {Record<string, object>} manifest
 * @param {string} viaKey manifest key of the root module
 * @param {string} [what] how to name the key in the error
 * @returns {string[]} dist-relative paths
 */
export const onlyReachableVia = (manifest, viaKey, what = 'Root') =>
  onlyReachableViaAny(manifest, [viaKey], what);

/**
 * Files only the squat tool can reach. Shared code — React, the entry chunk,
 * the tokens module — is the dashboard's, so the squat budget measures only
 * what the tool itself added.
 *
 * @param {Record<string, object>} manifest
 * @param {string} squatKey manifest key of the tool's root module
 * @returns {string[]} dist-relative paths
 */
export const squatOnlyFiles = (manifest, squatKey) =>
  onlyReachableVia(manifest, squatKey, 'Squat root');

/**
 * Files only the movement tools can reach, walked as one graph. Walked one
 * root at a time, a chunk two tools share is reachable from the other tool,
 * so it lands in the dashboard's TOTAL, in no tool's budget, and the prefix
 * check expects it plain (precached). Walked together, it stays a tool's.
 *
 * @param {Record<string, object>} manifest
 * @param {string[]} toolKeys manifest keys of every tool root
 * @returns {string[]} dist-relative paths
 */
export const toolOnlyFiles = (manifest, toolKeys) =>
  onlyReachableViaAny(manifest, toolKeys, 'Movement root');

/**
 * One movement's own share of the tool-only files: what its root reaches
 * without passing through the entry or another tool's root. A chunk the tools
 * share counts in every movement that reaches it.
 *
 * @param {Record<string, object>} manifest
 * @param {string} rootKey this movement's root
 * @param {string[]} toolKeys every tool root, this one included
 * @returns {string[]} dist-relative paths
 */
export function movementFiles(manifest, rootKey, toolKeys) {
  if (!toolKeys.includes(rootKey)) {
    throw new Error(`${rootKey} is not one of the movement roots.`);
  }
  const toolOnly = new Set(toolOnlyFiles(manifest, toolKeys));
  const stopAt = [
    ...entryKeys(manifest),
    ...toolKeys.filter((key) => key !== rootKey),
  ];
  return [...reachableFiles(manifest, [rootKey], { stopAt })].filter((f) =>
    toolOnly.has(f)
  );
}

/** The URLs Workbox wrote into sw.js's precache list ({url:"…",revision}). */
export const precacheUrls = (sw) =>
  [...(sw ?? '').matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);

/**
 * Whether sw.js still answers navigations with index.html. The tool chunks
 * left the precache; the page that loads them must not have.
 */
export const servesIndexNavigation = (sw) =>
  /NavigationRoute\([^()]*createHandlerBoundToURL\("index\.html"\)\)/.test(
    sw ?? ''
  );

const base = (f) => (f.startsWith('assets/') ? f.slice('assets/'.length) : f);

// ── The tool split's structural invariants ──────────────────────────
// Each returns a list of problems (empty = holds). Each guards a failure no
// byte budget would notice: three.js on a first paint can fit under a generous
// ceiling, and a mislabelled chunk changes nothing's size.

/**
 * The files only `via` reaches (one key, or several walked together) must be
 * on none of the boot graphs' first paints. `what` names them in the message
 * and `fix` says what to do; both default to the 3D chunk, the first thing
 * this guarded.
 * @param {Record<string, object>} manifest
 * @param {string|string[]} via
 * @param {string[]} bootKeys
 * @returns {string[]} problems; empty when the invariant holds
 */
export function firstPaintLeaks(
  manifest,
  via,
  bootKeys,
  { what = 'the 3D chunk', fix = 'Import it only through loadScene.js.' } = {}
) {
  const viaKeys = [].concat(via);
  const only = new Set(onlyReachableViaAny(manifest, viaKeys).map(base));
  const problems = [];
  if (!only.size) {
    problems.push(
      `Nothing is reachable only through ${viaKeys.join(', ')} — ${what} was merged into something else, or renamed.`
    );
  }
  for (const boot of bootKeys) {
    const leaked = entryFilesFrom(manifest, { bootKeys: [boot] })
      .map(base)
      .filter((f) => only.has(f));
    if (leaked.length) {
      problems.push(
        `${what[0].toUpperCase()}${what.slice(1)} is on ${boot}'s first paint: ${leaked.join(', ')}. ${fix}`
      );
    }
  }
  return problems;
}

/**
 * The tool-only JS (from the graph) and the prefixed JS (from the file names)
 * must be the same set: Workbox and the Android build trust the name.
 */
export function prefixMismatch(toolOnly, assetNames, prefixed) {
  const graph = toolOnly
    .map(base)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const named = assetNames.filter((f) => prefixed.test(f)).sort();
  if (graph.join('\n') === named.join('\n')) return [];
  return [
    `The tool-only JS and the anatomy-* JS differ.\n  tool-only: ${graph.join(', ')}\n  anatomy-*: ${named.join(', ')}\n  Fix scripts/movementAssets.mjs — Workbox and the Android build select by the prefix.`,
  ];
}

/**
 * No movement-tool file, code or data, may be in the precache list.
 * `isWebOnly` judges a dist/assets basename (movementAssets.mjs).
 */
export function precachedTool(urls, isWebOnly) {
  const hits = urls.filter((u) => {
    const asset = /(?:^|\/)assets\/([^/]+)$/.exec(u);
    return asset !== null && isWebOnly(asset[1]);
  });
  return hits.length
    ? [
        `sw.js precaches movement-tool files: ${hits.join(', ')}. They belong in globIgnores.`,
      ]
    : [];
}

/** No squat file may be in the precache list. */
export function precachedSquat(urls) {
  const hits = urls.filter((u) => /(^|\/)assets\/squat-/.test(u));
  return hits.length
    ? [
        `sw.js precaches squat files: ${hits.join(', ')}. They belong in globIgnores.`,
      ]
    : [];
}

/** No translated catalog may be in the precache list (i18nChunks.mjs). */
export function precachedI18n(urls) {
  const hits = urls.filter((u) => /(^|\/)assets\/i18n-/.test(u));
  return hits.length
    ? [
        `sw.js precaches translated catalogs: ${hits.join(', ')}. Every English install would download them; they belong in globIgnores.`,
      ]
    : [];
}

/**
 * A translated dashboard catalog's own files: all named i18n-*, and none of
 * them reachable from a movement tool (one product never loads the other's
 * words).
 * @param {Record<string, object>} manifest
 * @param {string} catalogKey
 * @param {string|string[]} toolKeys every tool root
 * @param {RegExp} named the catalog prefix (i18nChunks.mjs)
 * @returns {string[]} problems; empty when the invariant holds
 */
export function i18nCatalogProblems(manifest, catalogKey, toolKeys, named) {
  const files = onlyReachableVia(manifest, catalogKey, 'Catalog')
    .map(base)
    .filter((f) => f.endsWith('.js'));
  const problems = [];
  const unnamed = files.filter((f) => !named.test(f));
  if (!files.length || unnamed.length) {
    problems.push(
      `${catalogKey} did not build to i18n-* JS only (got: ${files.join(', ') || 'nothing'}). Fix scripts/i18nChunks.mjs — Workbox selects by the prefix.`
    );
  }
  // A tool statically imports the shared entry, which dynamically imports the
  // dashboard; walking through the entry would find everything. Stop there.
  const entries = entryKeys(manifest);
  for (const toolKey of [].concat(toolKeys)) {
    const fromTool = new Set(
      [...reachableFiles(manifest, [toolKey], { stopAt: entries })].map(base)
    );
    const shared = files.filter((f) => fromTool.has(f));
    if (shared.length) {
      problems.push(
        `${toolKey} can reach the dashboard catalog: ${shared.join(', ')}.`
      );
    }
  }
  return problems;
}

/**
 * The data rule. Each live dataset builds to exactly one file in dist/assets,
 * within its raw-byte budget; a pending one builds to none; and every .bin or
 * .json there belongs to exactly one dataset. Found by name, not by graph:
 * the worker sub-build emits a bin with no record in the manifest.
 *
 * @param {{ id: string, stem: string, ext: string, pattern: RegExp,
 *   budgetBytes: number|null, pending: string|null }[]} datasets
 * @param {string[]} assetNames dist/assets basenames
 * @param {(name: string) => number} sizeOf a file's raw bytes
 * @returns {{ files: { id: string, file: string|null, bytes: number|null,
 *   budgetBytes: number|null, pending: string|null }[], problems: string[] }}
 *   one row per dataset, in order; `file` is set when exactly one matches
 */
export function dataFileProblems(datasets, assetNames, sizeOf) {
  const problems = [];
  for (const name of assetNames) {
    const owners = datasets.filter((d) => d.pattern.test(name));
    if (owners.length > 1) {
      problems.push(
        `${name} matches more than one registered dataset (${owners.map((d) => d.id).join(', ')}).`
      );
    } else if (!owners.length && /\.(?:bin|json)$/.test(name)) {
      problems.push(
        `dist/assets/${name} is an unregistered data file. Register it in scripts/movementAssets.mjs so it is budgeted, stripped from the APK and served with its headers.`
      );
    }
  }
  const files = datasets.map(
    ({ id, stem, ext, pattern, budgetBytes, pending }) => {
      const found = assetNames.filter((name) => pattern.test(name));
      const file = found.length === 1 ? found[0] : null;
      const bytes = file === null ? null : sizeOf(file);
      if (pending) {
        if (found.length) {
          problems.push(
            `${id} is pending (${pending}) but dist/assets has ${found.join(', ')}. Measure it, set its budget (#504) and mark it live in scripts/movementAssets.mjs.`
          );
        }
      } else if (!found.length) {
        problems.push(
          `Expected exactly one ${id} file (${pattern}) in dist/assets, found none. Nothing imports ${stem}.${ext} with ?url, or Vite inlined it (under build.assetsInlineLimit): a data: URL that connect-src blocks.`
        );
      } else if (found.length > 1) {
        problems.push(
          `Expected exactly one ${id} file, found ${found.length}: ${found.join(', ')}. Two sources share the name, or dist/ is stale; rebuild from clean.`
        );
      } else if (bytes > budgetBytes) {
        problems.push(
          `${file} is ${bytes} bytes, over its ${budgetBytes}-byte budget (${id}). Raise it deliberately (#504) in scripts/movementAssets.mjs.`
        );
      }
      return { id, file, bytes, budgetBytes, pending };
    }
  );
  return { files, problems };
}

/**
 * Words a catalog must keep off a first paint, found by text: an English
 * catalog is a static import inside some chunk, with no manifest key of its
 * own, so the graph walk cannot name it. `phrases` are messages only that
 * catalog holds; any of them in a first-paint file means the catalog is there.
 * A phrase found in no file at all is reported too — the check would be blind.
 *
 * @param {{ file: string, text: string }[]} firstPaint first-paint files
 * @param {{ file: string, text: string }[]} all every emitted JS file
 * @param {string[]} phrases
 * @param {string} what  e.g. 'The views English catalog'
 * @returns {string[]} problems; empty when the invariant holds
 */
export function catalogTextLeaks(firstPaint, all, phrases, what) {
  if (!phrases.length) return [`${what}: no phrases to look for.`];
  const problems = [];
  const unseen = phrases.filter((p) => !all.some((f) => f.text.includes(p)));
  if (unseen.length === phrases.length) {
    problems.push(
      `${what} was not found in any built file (looked for "${phrases[0]}"), so its first-paint check is blind.`
    );
  }
  const leaked = firstPaint.filter((f) =>
    phrases.some((p) => f.text.includes(p))
  );
  if (leaked.length) {
    problems.push(
      `${what} is on first paint: ${leaked.map((f) => f.file).join(', ')}. Import it only from the lazy shells (src/i18n/views.js).`
    );
  }
  return problems;
}

// Integration names the Sentry SDK keeps as plain strings through
// minification. GlobalHandlers is a default integration (present only when
// Sentry.init is bundled); BrowserTracing is the one utils/sentry.js adds.
export const SENTRY_INIT_MARKERS = ['GlobalHandlers', 'BrowserTracing'];
// Valid shape, dead project: keeps the init path in the bundle and can never
// report anywhere. Never a real DSN. Mirrored in .github/workflows/ci-web.yml.
const PLACEHOLDER_DSN =
  'https://0123456789abcdef0123456789abcdef@o0.ingest.de.sentry.io/0';

/**
 * The size gate must measure the Sentry code production ships (#465).
 * initSentry() returns early without VITE_SENTRY_DSN, so a build without one
 * tree-shakes Sentry.init and its integrations out of the shared entry — ~49 KB
 * gzip that every production first paint carries and the gate would not see.
 *
 * @param {{ name: string, files: { file: string, text: string }[] }[]} products
 *   each product's first-paint JS
 * @returns {string[]} problems; empty when every first paint carries the init path
 */
export function sentryInitProblems(products) {
  return products.flatMap(({ name, files }) => {
    const missing = SENTRY_INIT_MARKERS.filter(
      (m) => !files.some((f) => f.text.includes(m))
    );
    return missing.length
      ? [
          `The ${name} first paint has no Sentry init path (missing ${missing.join(', ')}), so this build is lighter than production. Rebuild with the placeholder DSN the CI Build job uses: VITE_SENTRY_DSN=${PLACEHOLDER_DSN} npm run build (PowerShell: $env:VITE_SENTRY_DSN='${PLACEHOLDER_DSN}'; npm run build).`,
        ]
      : [];
  });
}

/** The service worker must still serve index.html for navigations. */
export const navigationProblems = (sw) =>
  servesIndexNavigation(sw)
    ? []
    : [
        'sw.js no longer answers navigations with index.html — check navigateFallback in vite.config.js.',
      ];
