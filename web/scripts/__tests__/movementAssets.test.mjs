// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18N_CHUNK_NAME, I18N_CODE_ROUTE } from '../i18nChunks.mjs';
import {
  DATA_CACHES,
  DATA_FILE_CAP_BYTES,
  DATA_RUNTIME_ROUTES,
  DATASETS,
  MOVEMENTS,
  PLAIN_CHUNK_NAME,
  SCENE,
  TOOL_CHUNK_NAME,
  TOOL_CODE_ROUTE,
  TOOL_DIRS,
  TOOL_GLOB_IGNORES,
  TOOL_JS,
  TOOL_PREFIX,
  chunkFileNames,
  dataPattern,
  dataUrlPattern,
  isToolOnly,
  isWebOnlyAsset,
  sampleName,
  toolChunkUrlPattern,
  vercelRules,
} from '../movementAssets.mjs';
import { DATA_ASSET } from '../../src/squat/constants/dataAsset.js';
import { OFFLINE_TEXT } from '../../src/i18n/lang.js';
import { MOVEMENT_ROUTES } from '../../src/utils/movementRoute.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = '/repo/web';
const ORIGIN = 'https://splitiq.test';
const routeOf = (id) => MOVEMENTS.find((m) => m.id === id).route;
const built = (name, pattern = TOOL_CHUNK_NAME) =>
  pattern
    .replace('assets/', '')
    .replace('[name]', name)
    .replace('[hash]', 'Ab12Cd34');

describe('isToolOnly', () => {
  it('accepts a chunk made only of squat, row, tool, anatomy, movements and three modules', () => {
    expect(
      isToolOnly([
        `${ROOT}/src/squat/SquatApp.jsx`,
        `${ROOT}/src/row/RowApp.jsx`,
        `${ROOT}/src/tool/ToolShell.jsx`,
        `${ROOT}/src/anatomy/scene/createAnatomyScene.js`,
        `${ROOT}/src/movements/squat/movement.js`,
        `${ROOT}/node_modules/three/build/three.module.js`,
      ])
    ).toBe(true);
    for (const dir of TOOL_DIRS) {
      expect(isToolOnly([`${ROOT}${dir}x.js`]), dir).toBe(true);
    }
  });

  it('rejects a mixed chunk, an empty or missing list, and look-alike folders (/src/rowing/, /src/tools/, /src/movementsX/, /node_modules/threejs-ext/)', () => {
    expect(
      isToolOnly([
        `${ROOT}/src/row/RowApp.jsx`,
        `${ROOT}/src/constants/tokens.js`,
      ])
    ).toBe(false);
    expect(isToolOnly([`${ROOT}/node_modules/react/index.js`])).toBe(false);
    expect(isToolOnly([])).toBe(false);
    expect(isToolOnly(undefined)).toBe(false);
    for (const lookAlike of [
      '/src/rowing/x.js',
      '/src/tools/x.js',
      '/src/movementsX/squat/x.js',
      '/node_modules/threejs-ext/x.js',
      '/src/squatter/x.js',
    ]) {
      expect(isToolOnly([`${ROOT}${lookAlike}`]), lookAlike).toBe(false);
    }
  });
});

describe('chunkFileNames', () => {
  it('anatomy-* for tool chunks, i18n-* for translated dashboard catalogs, plain otherwise', () => {
    expect(TOOL_CHUNK_NAME).toBe('assets/anatomy-[name]-[hash].js');
    expect(chunkFileNames({ moduleIds: [`${ROOT}/src/row/RowApp.jsx`] })).toBe(
      TOOL_CHUNK_NAME
    );
    expect(
      chunkFileNames({ moduleIds: [`${ROOT}/src/squat/SquatApp.jsx`] })
    ).toBe(TOOL_CHUNK_NAME);
    for (const catalog of ['src/locales/es.po', 'src/locales/views/es.po']) {
      expect(chunkFileNames({ moduleIds: [`${ROOT}/${catalog}`] })).toBe(
        I18N_CHUNK_NAME
      );
    }
    expect(chunkFileNames({ moduleIds: [`${ROOT}/src/App.jsx`] })).toBe(
      PLAIN_CHUNK_NAME
    );
    expect(chunkFileNames({ moduleIds: [] })).toBe(PLAIN_CHUNK_NAME);
    expect(chunkFileNames({})).toBe(PLAIN_CHUNK_NAME);
  });

  it('tool rule wins for src/squat/locales/es.po and src/row/locales/es.po', () => {
    for (const catalog of [
      'src/squat/locales/es.po',
      'src/row/locales/es.po',
    ]) {
      expect(chunkFileNames({ moduleIds: [`${ROOT}/${catalog}`] })).toBe(
        TOOL_CHUNK_NAME
      );
    }
  });

  it('names files TOOL_JS recognises', () => {
    for (const name of [
      'RowApp',
      'createAnatomyScene',
      'anatomyDecode.worker',
    ]) {
      expect(TOOL_JS.test(built(name)), name).toBe(true);
      expect(built(name).startsWith(TOOL_PREFIX)).toBe(true);
    }
    expect(TOOL_JS.test(built('RowApp', PLAIN_CHUNK_NAME))).toBe(false);
    expect(TOOL_JS.test(built('es', I18N_CHUNK_NAME))).toBe(false);
    for (const d of DATASETS) expect(TOOL_JS.test(sampleName(d))).toBe(false);
  });
});

describe('the registry', () => {
  it('movement ids, routes and roots are unique; routes are /<lowercase>; roots are under src/', () => {
    for (const key of ['id', 'title', 'route', 'root']) {
      const values = MOVEMENTS.map((m) => m[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
    for (const m of MOVEMENTS) {
      expect(m.id).toMatch(/^[a-z]+$/);
      expect(m.route).toMatch(/^\/[a-z]+$/);
      expect(m.root).toMatch(/^src\/[^/]+\/.+\.jsx?$/);
      // A root outside the tool dirs would build to a plain, precached chunk.
      expect(isToolOnly([`${ROOT}/${m.root}`]), m.root).toBe(true);
    }
    expect(isToolOnly([`${ROOT}/${SCENE.root}`])).toBe(true);
    expect(existsSync(join(WEB, SCENE.root))).toBe(true);
  });

  it("each movement's root is a committed file", () => {
    for (const { root } of MOVEMENTS) {
      expect(existsSync(join(WEB, root)), root).toBe(true);
    }
  });

  // RouteRoot's table is literal, so no build data reaches the first paint;
  // this is what keeps it and the registry the same list.
  it('MOVEMENT_ROUTES lists exactly the registered routes and ids', () => {
    expect(MOVEMENT_ROUTES).toEqual(
      Object.fromEntries(MOVEMENTS.map((m) => [m.route, m.id]))
    );
  });

  it('OFFLINE_TEXT has a line for every movement and no other', () => {
    expect(Object.keys(OFFLINE_TEXT).sort()).toEqual(
      MOVEMENTS.map((m) => m.id).sort()
    );
  });

  it("stems are unique and none is another's stem plus '-'; each sample matches only its own pattern", () => {
    const stems = DATASETS.map((d) => d.stem);
    expect(new Set(stems).size).toBe(stems.length);
    for (const a of stems) {
      for (const b of stems) {
        if (a !== b) expect(b.startsWith(`${a}-`), `${a} / ${b}`).toBe(false);
      }
    }
    for (const d of DATASETS) {
      expect(d.id).toBe(d.stem);
      expect(['bin', 'json']).toContain(d.ext);
      const owners = DATASETS.filter((o) => dataPattern(o).test(sampleName(d)));
      expect(owners.map((o) => o.id)).toEqual([d.id]);
      // The source's own name is not a built name: the build adds a hash.
      expect(dataPattern(d).test(`${d.stem}.${d.ext}`)).toBe(false);
    }
  });

  it('every dataset names registered movements and a DATA_CACHES entry', () => {
    const movements = new Set(MOVEMENTS.map((m) => m.id));
    const caches = new Set(DATA_CACHES.map((c) => c.cacheName));
    for (const d of DATASETS) {
      expect(d.movements.length, d.id).toBeGreaterThan(0);
      for (const id of d.movements) {
        expect(movements.has(id), `${d.id} names ${id}`).toBe(true);
      }
      expect(caches.has(d.cache), `${d.id} names ${d.cache}`).toBe(true);
    }
    for (const c of DATA_CACHES) {
      expect(
        DATASETS.some((d) => d.cache === c.cacheName),
        c.cacheName
      ).toBe(true);
    }
  });

  it('live datasets have a committed source `${stem}.${ext}` within budget and ≤ DATA_FILE_CAP_BYTES; pending ones have no source and no budget', () => {
    expect(DATASETS.some((d) => !d.pending)).toBe(true);
    for (const d of DATASETS) {
      if (d.pending) {
        expect(d.pending, d.id).toMatch(/^#\d+$/);
        expect(d.source, d.id).toBeNull();
        expect(d.budgetBytes, d.id).toBeNull();
        continue;
      }
      expect(d.source, d.id).toMatch(/^src\//);
      expect(basename(d.source)).toBe(`${d.stem}.${d.ext}`);
      expect(statSync(join(WEB, d.source)).size).toBeLessThanOrEqual(
        d.budgetBytes
      );
      expect(d.budgetBytes).toBeLessThanOrEqual(DATA_FILE_CAP_BYTES);
    }
  });

  it("the squat's live files match DATA_ASSET", () => {
    const pins = {
      'squat-anatomy': DATA_ASSET.bin,
      'squat-manifest': DATA_ASSET.manifest,
    };
    for (const [id, pin] of Object.entries(pins)) {
      const { source } = DATASETS.find((d) => d.id === id);
      expect(basename(source)).toBe(pin.file);
      const bytes = readFileSync(join(WEB, source));
      expect(bytes.length, id).toBe(pin.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), id).toBe(
        pin.sha256
      );
    }
  });

  // #504: a budget is set from a measured figure with Scott's yes, and the
  // comment beside it records when, who and what was measured.
  it("the row's budgets carry a dated comment naming Scott", () => {
    const src = readFileSync(join(WEB, 'scripts', 'movementAssets.mjs'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    const start = src.indexOf("id: 'row',");
    expect(start).toBeGreaterThan(-1);
    const row = MOVEMENTS.find((m) => m.id === 'row');
    for (const key of ['entryBudgetKb', 'totalBudgetKb']) {
      expect(Number.isInteger(row[key]) && row[key] > 0, key).toBe(true);
      const at = src.indexOf(`${key}: ${row[key]},`, start);
      expect(at, key).toBeGreaterThan(start);
      const comment = [];
      for (let i = at - 1; src[i].startsWith('//'); i--)
        comment.unshift(src[i]);
      const text = comment.join(' ');
      expect(text, key).toMatch(/\b20\d\d-\d\d-\d\d\b/);
      expect(text, key).toMatch(/\bScott\b/);
      expect(text, key).toMatch(/#504/);
      expect(text, key).toMatch(/Measured \d/);
    }
  });

  it('is frozen, so a consumer cannot edit what every other consumer reads', () => {
    for (const value of [
      TOOL_DIRS,
      SCENE,
      MOVEMENTS,
      MOVEMENTS[1],
      DATASETS,
      DATASETS[0].movements,
      DATA_CACHES,
      DATA_CACHES[0],
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

describe('caching', () => {
  const RULES = [
    ...DATA_RUNTIME_ROUTES.map((r) => [r.options.cacheName, r.urlPattern]),
    [TOOL_CODE_ROUTE.options.cacheName, TOOL_CODE_ROUTE.urlPattern],
    [I18N_CODE_ROUTE.options.cacheName, I18N_CODE_ROUTE.urlPattern],
  ];
  const rulesFor = (url) =>
    RULES.filter(([, re]) => re.test(url)).map(([name]) => name);

  it("each dataset's sample URL at the root and under its prefixes matches its own cache rule and no other rule (data caches, TOOL_CODE_ROUTE, I18N_CODE_ROUTE)", () => {
    for (const d of DATASETS) {
      const prefixes = ['', ...d.movements.map(routeOf)];
      for (const prefix of prefixes) {
        const url = `${ORIGIN}${prefix}/assets/${sampleName(d)}`;
        expect(rulesFor(url), url).toEqual([d.cache]);
      }
    }
  });

  it('TOOL_CODE_ROUTE matches tool JS at the root and under every prefix, keeping squat-code, 30 entries and 30 days', () => {
    expect(TOOL_CODE_ROUTE.handler).toBe('CacheFirst');
    expect(TOOL_CODE_ROUTE.options).toEqual({
      cacheName: 'squat-code',
      expiration: { maxEntries: 30, maxAgeSeconds: 2592000 },
      cacheableResponse: { statuses: [200] },
    });
    for (const prefix of ['', ...MOVEMENTS.map((m) => m.route)]) {
      for (const name of ['SquatApp', 'RowApp', 'anatomyDecode.worker']) {
        const url = `${ORIGIN}${prefix}/assets/${built(name)}`;
        expect(rulesFor(url), url).toEqual(['squat-code']);
      }
    }
    expect(rulesFor(`${ORIGIN}/assets/index-Ab12Cd34.js`)).toEqual([]);
    expect(
      rulesFor(`${ORIGIN}/assets/${built('es', I18N_CHUNK_NAME)}`)
    ).toEqual(['i18n-code']);
  });

  it('the squat-data rule is the 5def051 rule', () => {
    // vite.config.js's runtimeCaching entry at 5def051, verbatim.
    const before = {
      urlPattern: /\/assets\/squat-(anatomy|manifest)-.*\.(bin|json)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'squat-data',
        expiration: { maxEntries: 4 },
        cacheableResponse: { statuses: [200] },
      },
    };
    const now = DATA_RUNTIME_ROUTES.find(
      (r) => r.options.cacheName === 'squat-data'
    );
    expect(now).toEqual(before);
    expect(now.urlPattern.source).toBe(before.urlPattern.source);
    expect(now.urlPattern.flags).toBe('');
    // The same key order, so the generated sw.js reads the same.
    expect(Object.keys(now)).toEqual(Object.keys(before));
    expect(Object.keys(now.options)).toEqual(Object.keys(before.options));
  });

  it('every data cache is cache-first, 200s only, capped by entries and never by age', () => {
    expect(DATA_RUNTIME_ROUTES).toHaveLength(DATA_CACHES.length);
    DATA_RUNTIME_ROUTES.forEach((route, i) => {
      const { cacheName, urlPattern, maxEntries } = DATA_CACHES[i];
      expect(route).toEqual({
        urlPattern,
        handler: 'CacheFirst',
        options: {
          cacheName,
          expiration: { maxEntries },
          cacheableResponse: { statuses: [200] },
        },
      });
    });
    expect(
      Object.fromEntries(DATA_CACHES.map((c) => [c.cacheName, c.maxEntries]))
    ).toEqual({ 'squat-data': 4, 'anatomy-body': 2, 'row-data': 4 });
  });

  // vite.config.js cannot be imported outside Vite (vite-plugin-pwa resolves
  // itself from the config's location at import), so its wiring is pinned at
  // the source; `npm run size` then checks what the build actually named and
  // precached.
  it('vite.config.js wires chunkFileNames, the worker name, globIgnores and runtimeCaching from the registry', () => {
    const src = readFileSync(join(WEB, 'vite.config.js'), 'utf8');
    const [, names] =
      /import\s*\{([^}]*)\}\s*from\s*'\.\/scripts\/movementAssets\.mjs';/.exec(
        src
      ) ?? [];
    expect(names, 'imports the registry').toBeDefined();
    for (const name of [
      'DATA_RUNTIME_ROUTES',
      'TOOL_CHUNK_NAME',
      'TOOL_CODE_ROUTE',
      'TOOL_GLOB_IGNORES',
      'chunkFileNames',
    ]) {
      expect(names).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(src).toMatch(
      /build:\s*\{[^}]*rolldownOptions:\s*\{\s*output:\s*\{\s*chunkFileNames\s*\}\s*\}/
    );
    expect(src).toMatch(
      /worker:\s*\{\s*rolldownOptions:\s*\{\s*output:\s*\{\s*entryFileNames:\s*TOOL_CHUNK_NAME\s*\}/
    );
    expect(src).toMatch(
      /globIgnores:\s*TOOL_GLOB_IGNORES\.concat\(I18N_GLOB_IGNORES\)/
    );
    // The data caches come first; the code routes follow, in this order.
    expect(src).toMatch(
      /runtimeCaching:\s*\[\s*\.\.\.DATA_RUNTIME_ROUTES,[\s\S]*?\bTOOL_CODE_ROUTE,[\s\S]*?\bI18N_CODE_ROUTE,/
    );
    // No tool rule is written inline any more, and the old module is gone.
    expect(src).not.toMatch(/squatChunks|squat-\(anatomy|cacheName:\s*'squat-/);
  });

  it('leaves tool JS and every registered data file out of the precache, by name', () => {
    expect(TOOL_GLOB_IGNORES).toEqual([
      '**/assets/anatomy-*.js',
      '**/assets/squat-anatomy-*.bin',
      '**/assets/squat-manifest-*.json',
      '**/assets/anatomy-body-*.bin',
      '**/assets/row-motion-*.bin',
      '**/assets/row-manifest-*.json',
    ]);
  });
});

describe('the web-only files', () => {
  it('are the tool JS and the data files, and no app file', () => {
    for (const d of DATASETS) expect(isWebOnlyAsset(sampleName(d))).toBe(true);
    for (const name of [
      'SquatApp',
      'RowApp',
      'three',
      'anatomyDecode.worker',
    ]) {
      expect(isWebOnlyAsset(built(name)), name).toBe(true);
    }
    for (const name of [
      'index-Ab12Cd34.js',
      'index-Ab12Cd34.css',
      built('es', I18N_CHUNK_NAME),
      'archivo-var-Ab12Cd34.woff2',
      'tokens-Ab12Cd34.js',
    ]) {
      expect(isWebOnlyAsset(name), name).toBe(false);
    }
  });
});

describe('vercelRules', () => {
  const vercel = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
  const rules = vercelRules();

  it("gives the squat exactly today's vercel.json rewrites and octet-stream sources", () => {
    const squat = (list) => list.filter((r) => r.source.startsWith('/squat/'));
    expect(squat(rules.rewrites)).toEqual(squat(vercel.rewrites));
    expect(squat(rules.rewrites)).toHaveLength(3);
    const octet = vercel.headers
      .filter(({ headers }) =>
        headers.some(
          (h) =>
            h.key === 'Content-Type' && h.value === 'application/octet-stream'
        )
      )
      .map((h) => h.source)
      .filter((s) => s.includes('squat-anatomy'));
    expect(
      rules.octetStream.filter((s) => s.includes('squat-anatomy'))
    ).toEqual(octet);
    expect(octet).toHaveLength(2);
  });

  it('gives every movement the same three rewrites, an immutable prefix, and every bin octet-stream under its prefixes', () => {
    for (const { route } of MOVEMENTS) {
      expect(
        rules.rewrites.filter((r) => r.source.startsWith(`${route}/`))
      ).toEqual([
        { source: `${route}/assets/(.*)`, destination: '/assets/$1' },
        { source: `${route}/icons/(.*)`, destination: '/icons/$1' },
        {
          source: `${route}/(registerSW\\.js|manifest\\.webmanifest)`,
          destination: '/$1',
        },
      ]);
    }
    expect(rules.immutable).toEqual([
      '/assets/(.*)',
      ...MOVEMENTS.map((m) => `${m.route}/assets/(.*)`),
    ]);
    expect(rules.octetStream).toEqual([
      '/assets/squat-anatomy-(.*)\\.bin',
      '/squat/assets/squat-anatomy-(.*)\\.bin',
      '/assets/anatomy-body-(.*)\\.bin',
      '/row/assets/anatomy-body-(.*)\\.bin',
      '/assets/row-motion-(.*)\\.bin',
      '/row/assets/row-motion-(.*)\\.bin',
    ]);
  });
});

describe('e2e URL patterns', () => {
  it('match a tool chunk and each data file at the root and under a prefix, and nothing near them', () => {
    const scene = toolChunkUrlPattern('createAnatomyScene');
    expect(scene.test(`${ORIGIN}/assets/${built('createAnatomyScene')}`)).toBe(
      true
    );
    expect(
      scene.test(`${ORIGIN}/squat/assets/${built('createAnatomyScene')}`)
    ).toBe(true);
    expect(scene.test(`${ORIGIN}/assets/${built('createAnatomySceneX')}`)).toBe(
      false
    );
    const worker = toolChunkUrlPattern('anatomyDecode.worker');
    expect(
      worker.test(`${ORIGIN}/assets/${built('anatomyDecode.worker')}`)
    ).toBe(true);
    expect(
      worker.test(`${ORIGIN}/assets/${built('anatomyDecodeXworker')}`)
    ).toBe(false);
    for (const d of DATASETS) {
      const re = dataUrlPattern(d.id);
      for (const prefix of ['', ...d.movements.map(routeOf)]) {
        expect(re.test(`${ORIGIN}${prefix}/assets/${sampleName(d)}`)).toBe(
          true
        );
      }
      expect(re.test(`${ORIGIN}/assets/${d.stem}.${d.ext}`)).toBe(false);
    }
    expect(() => dataUrlPattern('squat-data')).toThrow(
      /No registered dataset squat-data/
    );
  });
});

describe('data imports', () => {
  const SRC = join(WEB, 'src');
  const sourceFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
      return /\.(js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)
        ? [p]
        : [];
    });
  const REFERENCE = /(?:\bfrom|\bimport|\bnew\s+URL)\s*\(?\s*['"]([^'"]+)['"]/g;
  const DATA_FILES = new Map(DATASETS.map((d) => [`${d.stem}.${d.ext}`, d]));

  // Manifests are data, never JS: a bare JSON import would be parsed and
  // re-serialised into a chunk, and a ?url asset under the inline limit
  // becomes a data: URL that connect-src blocks.
  it('every src import of a registered data file uses ?url, and bins are imported only by workers/*.worker.js', () => {
    const found = [];
    const bad = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(WEB, file).split(sep).join('/');
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(REFERENCE)) {
        const [path, query] = spec.split('?');
        const dataset = DATA_FILES.get(path.split('/').pop());
        if (!dataset) continue;
        found.push(`${rel} → ${spec}`);
        if (query !== 'url') bad.push(`${rel}: ${spec} has no ?url`);
        if (
          dataset.ext === 'bin' &&
          !/(?:^|\/)workers\/[^/]+\.worker\.js$/.test(rel)
        ) {
          bad.push(`${rel}: only a workers/*.worker.js may import ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // The scan sees the real imports, so it cannot pass by finding nothing.
    expect(found).toEqual(
      expect.arrayContaining([
        'src/squat/SquatApp.jsx → ./assets/squat-manifest.json?url',
        'src/squat/workers/anatomyDecode.worker.js → ../assets/squat-anatomy.bin?url',
      ])
    );
  });
});
