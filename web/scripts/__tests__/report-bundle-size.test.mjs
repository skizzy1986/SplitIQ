// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

// The CI report reads dist/bundle-size.json from its working directory and
// the main-branch baseline from its argument, so it runs here as CI runs it.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'report-bundle-size.mjs'
);
const dir = mkdtempSync(join(tmpdir(), 'size-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

mkdirSync(join(dir, 'dist'));
writeFileSync(
  join(dir, 'dist', 'bundle-size.json'),
  JSON.stringify({
    budgetKb: 433,
    total: 419004,
    assets: [{ file: 'index-a.js', gzip: 141626 }],
    entryBudgetKb: 208,
    entry: 183913,
    entryAssets: [{ file: 'index-a.js', gzip: 141626 }],
    squat3dBudgetKb: 145,
    squat3d: 141772,
    movements: {
      squat: {
        title: 'Squat',
        route: '/squat',
        entryBudgetKb: 173,
        entry: 175555,
        totalBudgetKb: 34,
        total: 34133,
      },
      row: {
        title: 'Row',
        route: '/row',
        entryBudgetKb: 142,
        entry: 143303,
        totalBudgetKb: 3,
        total: 1075,
      },
    },
  })
);

function report(baseline) {
  const path = join(dir, 'baseline.json');
  writeFileSync(path, JSON.stringify(baseline));
  return execFileSync('node', [SCRIPT, path], { cwd: dir, encoding: 'utf8' });
}
const rowOf = (out, label) =>
  out.split('\n').find((line) => line.startsWith(`| ${label} |`));

describe('report-bundle-size', () => {
  it("reads a baseline cached before #756: the squat's old keys give its deltas and a new tool reads no baseline", () => {
    const out = report({
      entry: 183746,
      total: 418791,
      squatEntry: 174909,
      squatTotal: 33635,
      squat3d: 141769,
    });
    expect(rowOf(out, 'Squat entry')).toContain('**+0.6 KB**');
    expect(rowOf(out, 'Squat total')).toContain('**±0.0 KB**');
    expect(rowOf(out, 'Row entry')).toContain('_no baseline_');
    expect(rowOf(out, 'Row total')).toContain('_no baseline_');
    expect(rowOf(out, '3D (shared)')).toContain('**±0.0 KB**');
    expect(out).not.toMatch(/Squat 3D/);
  });

  it('prefers the movements block once the baseline has one', () => {
    const out = report({
      entry: 183913,
      total: 419004,
      squatEntry: 1,
      squatTotal: 1,
      squat3d: 141772,
      movements: {
        squat: { entry: 175555 - 2048, total: 34133 },
        row: { entry: 143303, total: 1075 },
      },
    });
    expect(rowOf(out, 'Squat entry')).toContain('**+2.0 KB**');
    expect(rowOf(out, 'Squat total')).toContain('**±0.0 KB**');
    expect(rowOf(out, 'Row entry')).toContain('**±0.0 KB**');
    expect(rowOf(out, 'Row total')).toContain('**±0.0 KB**');
  });
});
