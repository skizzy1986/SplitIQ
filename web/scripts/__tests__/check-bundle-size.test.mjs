// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll } from 'vitest';
import { SENTRY_INIT_MARKERS } from '../entry-graph.mjs';
import { DATASETS, MOVEMENTS, SCENE, sampleName } from '../movementAssets.mjs';

// The size gate end to end, on a small synthetic build. Its helpers are
// unit-tested in entry-graph*.test.mjs; this checks that the script wires
// them up for every movement and writes the report CI reads. The script reads
// dist/ and the two English catalogs from its working directory, as
// `npm run size` runs it from web/, so each fixture is a web root of its own.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-bundle-size.mjs'
);
const tmp = mkdtempSync(join(tmpdir(), 'check-bundle-size-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const at = (name) => `assets/${name}-Ab12Cd34.js`;
const base = (file) => file.slice('assets/'.length);
const stem = (root) =>
  root
    .split('/')
    .pop()
    .replace(/\.jsx?$/, '');
const MAIN = at('index');
const CSS = 'assets/index-Ab12Cd34.css';
const AUTH = at('AuthGate');
const TOKENS = at('tokens');
const APP = at('App');
const ES = {
  'src/locales/es.po': at('i18n-es'),
  'src/locales/views/es.po': at('i18n-es-views'),
};
const TOOL = Object.fromEntries(
  MOVEMENTS.map(({ id, root }) => [id, at(`anatomy-${stem(root)}`)])
);
const SHARED = at('anatomy-shared');
const SCENE_JS = at('anatomy-createAnatomyScene');
const LIVE = DATASETS.filter((d) => !d.pending);
const BIN = DATASETS.find((d) => d.id === 'squat-anatomy');
// The gate's probe for the views English catalog: a message only that
// catalog holds, which must sit in a lazy chunk and on no first paint.
const VIEWS_EN = 'No upcoming planned sessions.';

/** A build that passes every gate: main lazily loads AuthGate or a tool. */
function fixture() {
  const manifest = {
    'index.html': {
      file: MAIN,
      isEntry: true,
      dynamicImports: ['src/AuthGate.jsx', ...MOVEMENTS.map((m) => m.root)],
      css: [CSS],
    },
    'src/AuthGate.jsx': {
      file: AUTH,
      isDynamicEntry: true,
      imports: ['index.html', '_tokens-Ab12Cd34.js'],
      dynamicImports: ['src/App.jsx', 'src/locales/es.po'],
    },
    '_tokens-Ab12Cd34.js': { file: TOKENS },
    'src/App.jsx': {
      file: APP,
      isDynamicEntry: true,
      imports: ['index.html'],
      dynamicImports: ['src/locales/views/es.po'],
    },
    ...Object.fromEntries(
      Object.entries(ES).map(([key, file]) => [
        key,
        { file, isDynamicEntry: true },
      ])
    ),
    // Each tool: its own root chunk, a chunk every tool shares, the scene
    // behind a lazy import, and its data files listed as assets.
    ...Object.fromEntries(
      MOVEMENTS.map(({ id, root }) => [
        root,
        {
          file: TOOL[id],
          isDynamicEntry: true,
          imports: [
            'index.html',
            '_tokens-Ab12Cd34.js',
            '_anatomy-shared-Ab12Cd34.js',
          ],
          dynamicImports: [SCENE.root],
          assets: LIVE.filter((d) => d.movements.includes(id)).map(
            (d) => `assets/${sampleName(d)}`
          ),
        },
      ])
    ),
    '_anatomy-shared-Ab12Cd34.js': { file: SHARED },
    [SCENE.root]: {
      file: SCENE_JS,
      isDynamicEntry: true,
      imports: ['_anatomy-shared-Ab12Cd34.js'],
    },
  };
  const files = {
    'index.html': `<script type="module" src="/${MAIN}"></script>`,
    // Every first paint carries the Sentry init path (#465).
    [MAIN]: `main(${JSON.stringify(SENTRY_INIT_MARKERS)})`,
    [CSS]: 'body{margin:0}',
    [AUTH]: 'auth',
    [TOKENS]: 'tokens',
    [APP]: `t(${JSON.stringify(VIEWS_EN)})`,
    ...Object.fromEntries(Object.values(ES).map((file) => [file, 'es'])),
    ...Object.fromEntries(MOVEMENTS.map(({ id }) => [TOOL[id], id])),
    [SHARED]: 'shared',
    [SCENE_JS]: 'three',
    ...Object.fromEntries(LIVE.map((d) => [`assets/${sampleName(d)}`, d.id])),
  };
  // Workbox's list: the dashboard's files only.
  const precache = ['index.html', MAIN, CSS, AUTH, TOKENS, APP];
  return { manifest, files, precache };
}

const po = (...ids) =>
  ['msgid ""', 'msgstr ""', '']
    .concat(
      ids.flatMap((id) => [
        `msgid ${JSON.stringify(id)}`,
        `msgstr ${JSON.stringify(id)}`,
        '',
      ])
    )
    .join('\n');

let n = 0;
/** Writes the fixture as a web root and runs the gate from it. */
function size({ manifest, files, precache }) {
  const root = join(tmp, `web-${(n += 1)}`);
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) {
    write(join('dist', path), text);
  }
  write('dist/.vite/manifest.json', JSON.stringify(manifest));
  write(
    'dist/sw.js',
    `e.precacheAndRoute([${precache.map((url) => `{url:"${url}",revision:null}`).join(',')}],{});` +
      'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")));'
  );
  write('src/locales/en.po', po('Sign in'));
  write('src/locales/views/en.po', po(VIEWS_EN));
  const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
  });
  const report = join(root, 'dist', 'bundle-size.json');
  return {
    status,
    stdout,
    stderr,
    json: existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null,
  };
}

// Hex digests: deterministic, and gzip keeps about half of them, so 2.5
// characters per byte wanted clears the mark.
function incompressible(gzipBytes) {
  let text = '';
  for (let i = 0; text.length < gzipBytes * 2.5; i += 1) {
    text += createHash('sha256').update(String(i)).digest('hex');
  }
  return text;
}

const files = (rows) => rows.map((r) => r.file).sort();
const sorted = (list) => list.map(base).sort();

describe('check-bundle-size.mjs on a fixture build', () => {
  it('passes a build within every budget and writes the report CI reads', () => {
    const { status, stdout, stderr, json } = size(fixture());
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('✓ Within budget (');
    for (const m of MOVEMENTS) {
      expect(stdout).toContain(`${m.id} entry  (budget ${m.entryBudgetKb} KB)`);
      expect(stdout).toContain(`${m.id} total  (budget ${m.totalBudgetKb} KB)`);
    }

    // The dashboard: no tool file and no Spanish in its figures.
    expect(files(json.entryAssets)).toEqual(sorted([MAIN, CSS, AUTH, TOKENS]));
    expect(files(json.assets)).toEqual(sorted([MAIN, CSS, AUTH, TOKENS, APP]));
    expect(files(json.dashEsAssets)).toEqual(sorted(Object.values(ES)));

    // Every movement, each from its own root: its first paint, and its total
    // with the chunk the tools share in it and the scene out of it.
    expect(Object.keys(json.movements)).toEqual(MOVEMENTS.map((m) => m.id));
    expect(json.movements).toHaveProperty('squat');
    expect(json.movements).toHaveProperty('row');
    for (const m of MOVEMENTS) {
      const own = json.movements[m.id];
      expect(own).toMatchObject({
        title: m.title,
        route: m.route,
        entryBudgetKb: m.entryBudgetKb,
        totalBudgetKb: m.totalBudgetKb,
      });
      expect(files(own.entryAssets), m.id).toEqual(
        sorted([MAIN, CSS, TOOL[m.id], TOKENS, SHARED])
      );
      expect(files(own.totalAssets), m.id).toEqual(
        sorted([TOOL[m.id], SHARED])
      );
      expect(own.total).toBe(own.totalAssets.reduce((s, a) => s + a.gzip, 0));
    }
    expect(files(json.squat3dAssets)).toEqual([base(SCENE_JS)]);

    // The keys a baseline cached before #756 still reads.
    expect(json.squatEntry).toBe(json.movements.squat.entry);
    expect(json.squatTotal).toBe(json.movements.squat.total);
    expect(json.squat3d).toBe(json.squat3dAssets[0].gzip);
    expect(json.squatData).toEqual({
      file: sampleName(BIN),
      // Raw bytes: each fixture data file holds its dataset id.
      bytes: BIN.id.length,
      budgetBytes: BIN.budgetBytes,
    });
    expect(json.data.map((d) => [d.id, d.file])).toEqual(
      DATASETS.map((d) => [d.id, d.pending ? null : sampleName(d)])
    );
  });

  // The failure #813 names: a movement whose budget nothing gates.
  it.each(MOVEMENTS.map((m) => [m.title, m]))(
    'fails when the %s root chunk is over its budget, and names it',
    (title, m) => {
      const fx = fixture();
      const over = (m.totalBudgetKb + 1) * 1024;
      fx.files[TOOL[m.id]] = incompressible(over);
      expect(gzipSync(fx.files[TOOL[m.id]]).length).toBeGreaterThan(over);
      const { status, stderr, json } = size(fx);
      expect(status).toBe(1);
      expect(stderr).toMatch(
        new RegExp(`✖ ${title} (entry|total) is [\\d.]+ KB over the`)
      );
      for (const other of MOVEMENTS.filter((o) => o !== m)) {
        expect(stderr).not.toContain(`✖ ${other.title} `);
      }
      // Written before the gates fail, so the PR comment still shows it.
      expect(json.movements[m.id].total).toBeGreaterThan(
        m.totalBudgetKb * 1024
      );
    }
  );

  it('fails a build with a second squat-anatomy bin, with the exactly-one message', () => {
    const fx = fixture();
    const second = sampleName(BIN).replace('Ab12Cd34', 'Zz99Yy88');
    fx.files[`assets/${second}`] = 'stale';
    const { status, stderr } = size(fx);
    expect(status).toBe(1);
    expect(stderr).toContain(
      '✖ Expected exactly one squat-anatomy file, found 2: '
    );
    expect(stderr).toContain(sampleName(BIN));
    expect(stderr).toContain(second);
    expect(stderr).toContain('rebuild from clean.');
  });

  it('fails a build whose sw.js precaches a tool chunk', () => {
    const fx = fixture();
    fx.precache.push(TOOL.row);
    const { status, stderr } = size(fx);
    expect(status).toBe(1);
    expect(stderr).toContain(
      `✖ sw.js precaches movement-tool files: ${TOOL.row}. They belong in globIgnores.`
    );
  });
});
