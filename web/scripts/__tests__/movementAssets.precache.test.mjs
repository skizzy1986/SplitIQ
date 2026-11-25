// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { I18N_GLOB_IGNORES } from '../i18nChunks.mjs';
import {
  DATASETS,
  MOVEMENTS,
  TOOL_GLOB_IGNORES,
  isWebOnlyAsset,
  sampleName,
} from '../movementAssets.mjs';

// workbox-build is vite-plugin-pwa's dependency, not this package's, so it is
// loaded from the plugin's own folder: the copy `npm run build` runs, wherever
// npm installs it. A devDependency of our own could drift from the plugin's
// copy under Dependabot, and this test would then check a different Workbox
// from the one the build runs (#813).
function workboxBuild() {
  let plugin;
  try {
    plugin = createRequire(import.meta.url).resolve(
      'vite-plugin-pwa/package.json'
    );
    return createRequire(plugin)('workbox-build');
  } catch (error) {
    throw new Error(
      `Cannot load workbox-build through vite-plugin-pwa (${plugin ? dirname(plugin) : 'not found'}): ${error.message}\n` +
        'This test runs the Workbox the build runs. If the plugin no longer depends on workbox-build, change the test with it.',
      { cause: error }
    );
  }
}
const { getManifest } = workboxBuild();

// What Workbox would precache, computed by the workbox-build that
// vite-plugin-pwa runs (generateSW reads dist the same way getManifest does).
// vite.config.js cannot be imported outside Vite, so its globPatterns are read
// from its source, and its globIgnores are the registry exports its source
// names (pinned below and in movementAssets.test.mjs).
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = readFileSync(join(WEB, 'vite.config.js'), 'utf8');

function precacheOptions() {
  const [, list] = /globPatterns:\s*(\[[^\]]*\])/.exec(CONFIG) ?? [];
  expect(list, 'vite.config.js sets globPatterns').toBeDefined();
  expect(CONFIG).toMatch(
    /globIgnores:\s*TOOL_GLOB_IGNORES\.concat\(I18N_GLOB_IGNORES\)/
  );
  return {
    globPatterns: JSON.parse(list.replace(/'/g, '"')),
    globIgnores: TOOL_GLOB_IGNORES.concat(I18N_GLOB_IGNORES),
  };
}

const chunk = (name) => `assets/anatomy-${name}-Ab12Cd34.js`;
const TOOL_FILES = [
  ...MOVEMENTS.map(({ root }) =>
    chunk(
      root
        .split('/')
        .pop()
        .replace(/\.jsx?$/, '')
    )
  ),
  chunk('createAnatomyScene'),
  chunk('three'),
  chunk('anatomyDecode.worker'),
  ...DATASETS.map((d) => `assets/${sampleName(d)}`),
];
const APP_FILES = [
  'index.html',
  'registerSW.js',
  'icons/icon-192.png',
  'assets/index-Ab12Cd34.js',
  'assets/index-Ab12Cd34.css',
  'assets/AuthGate-Ab12Cd34.js',
  'assets/tokens-Ab12Cd34.js',
  'assets/archivo-var-Ab12Cd34.woff2',
];
const I18N_FILES = ['assets/i18n-es-Ab12Cd34.js'];

const dist = mkdtempSync(join(tmpdir(), 'precache-'));
afterAll(() => rmSync(dist, { recursive: true, force: true }));
for (const file of [...TOOL_FILES, ...APP_FILES, ...I18N_FILES]) {
  mkdirSync(dirname(join(dist, file)), { recursive: true });
  writeFileSync(join(dist, file), file);
}

const precached = async (options) => {
  const { manifestEntries, warnings } = await getManifest({
    globDirectory: dist,
    ...options,
  });
  expect(warnings).toEqual([]);
  return manifestEntries.map((e) => e.url).sort();
};

describe('the precache', () => {
  it('a fixture dist precaches app files and none of the registered tool or data files', async () => {
    expect(await precached(precacheOptions())).toEqual([...APP_FILES].sort());
    // The fixture is the registry's own idea of a tool file, so the gate's
    // precache check (I9) names each of them too.
    for (const file of TOOL_FILES) {
      expect(isWebOnlyAsset(file.slice('assets/'.length)), file).toBe(true);
    }
  });

  // The data extensions sit outside globPatterns today; the ignores make that
  // a decision rather than an accident, so they must hold on their own.
  it('keeps every data file out by its ignore alone, were globPatterns widened to bin and json', async () => {
    const options = precacheOptions();
    const widened = options.globPatterns.map((p) =>
      p.replace(/\}$/, ',bin,json}')
    );
    expect(widened).not.toEqual(options.globPatterns);
    expect(await precached({ ...options, globPatterns: widened })).toEqual(
      [...APP_FILES].sort()
    );
  });
});
