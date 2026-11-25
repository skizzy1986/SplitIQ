// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { DATASETS, sampleName } from '../movementAssets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'strip-tool-assets.mjs');
const WORKFLOW = join(
  HERE,
  '..',
  '..',
  '..',
  '.github/workflows/ci-android.yml'
);

const TOOL = [
  'anatomy-SquatApp-Ab12Cd34.js',
  'anatomy-RowApp-Ab12Cd34.js',
  'anatomy-anatomyDecode.worker-Ab12Cd34.js',
  'anatomy-createAnatomyScene-Ab12Cd34.js',
  ...DATASETS.map(sampleName),
];
const APP = [
  'index-Ab12Cd34.js',
  'index-Ab12Cd34.css',
  'AuthGate-Ab12Cd34.js',
  'tokens-Ab12Cd34.js',
  'i18n-es-Ab12Cd34.js',
  'i18n-es-Cd34Ef56.js',
  'archivo-var-Ab12Cd34.woff2',
];

const root = mkdtempSync(join(tmpdir(), 'strip-tool-assets-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
function assets(names) {
  const dir = join(root, `assets-${(n += 1)}`);
  mkdirSync(dir);
  for (const name of names) writeFileSync(join(dir, name), name);
  return dir;
}
const cli = (...args) => {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [SCRIPT, ...args],
    { encoding: 'utf8' }
  );
  return { status, stdout, stderr };
};

describe('strip-tool-assets', () => {
  it('strips exactly the web-only files and keeps app JS, i18n catalogs and fonts', () => {
    const dir = assets([...TOOL, ...APP]);
    const { status, stdout } = cli(dir);
    expect(status).toBe(0);
    expect(readdirSync(dir).sort()).toEqual([...APP].sort());
    for (const name of TOOL) expect(stdout).toContain(`removed ${name}`);
    const bytes = TOOL.reduce((sum, name) => sum + name.length, 0);
    expect(stdout).toContain(
      `removed ${TOOL.length} web-only files, ${bytes} bytes`
    );
  });

  it('--check passes after the strip and exits 1 before it, naming the files', () => {
    const dir = assets([...TOOL, ...APP]);
    const before = cli('--check', dir);
    expect(before.status).toBe(1);
    for (const name of TOOL) expect(before.stderr).toContain(name);
    for (const name of APP) expect(before.stderr).not.toContain(name);
    // --check never removes anything.
    expect(readdirSync(dir)).toHaveLength(TOOL.length + APP.length);
    expect(cli(dir).status).toBe(0);
    const after = cli('--check', dir);
    expect(after.status).toBe(0);
    expect(after.stdout).toMatch(/no web-only movement-tool files/);
  });

  it('exits 1 with no anatomy-* chunk; exits 2 without a directory', () => {
    const dashboardOnly = assets([...APP, sampleName(DATASETS[0])]);
    const none = cli(dashboardOnly);
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/found no anatomy-\* chunks to strip/);
    // Nothing is removed when the build looks wrong.
    expect(existsSync(join(dashboardOnly, sampleName(DATASETS[0])))).toBe(true);

    expect(cli().status).toBe(2);
    expect(cli().stderr).toMatch(/^usage: /);
    expect(cli('--check').status).toBe(2);
    expect(cli(join(root, 'missing')).status).toBe(2);
    expect(cli(join(root, 'missing')).stderr).toMatch(/is not a directory/);
    const file = join(root, 'a-file');
    writeFileSync(file, '');
    expect(cli(file).status).toBe(2);
    expect(cli(dashboardOnly, dashboardOnly).status).toBe(2);
  });

  it('ci-android.yml runs the strip and the check and no longer globs squat-*', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    const job = yml.slice(yml.indexOf('\n  build-apk:'));
    const at = (text) => {
      const i = job.indexOf(text);
      expect(i, text).toBeGreaterThan(-1);
      return i;
    };
    const strip = at('run: node scripts/strip-tool-assets.mjs dist/assets');
    const check = at('node scripts/strip-tool-assets.mjs --check dist/assets');
    // The script needs the repo and Node; the assets need the build artefact.
    expect(at('uses: actions/checkout@')).toBeLessThan(strip);
    expect(at('uses: actions/setup-node@')).toBeLessThan(strip);
    expect(at('name: web-dist')).toBeLessThan(strip);
    expect(strip).toBeLessThan(check);
    expect(check).toBeLessThan(at('run: npx cap sync android'));
    // The Spanish catalogs still have to ship.
    expect(job).toContain('ls dist/assets/i18n-es-*.js');
    expect(job).toMatch(/if \[ "\$count" -lt 2 \]/);
    expect(yml).not.toMatch(/squat-\*/);
  });
});
