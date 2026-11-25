#!/usr/bin/env node
// Renders the CI bundle-size report as markdown on stdout: the current gzipped
// sizes (dist/bundle-size.json, written by check-bundle-size.mjs) diffed
// against the main-branch baseline restored by actions/cache. Reporting only —
// the pass/fail gates stay in check-bundle-size.mjs.
//
// ENTRY leads, because it is what a first paint costs and the tight ratchet.
// TOTAL follows as the loose ceiling. A baseline cached before #331 has no
// `entry` field; say so rather than inventing a delta from the total. Then
// each movement tool's entry and total (scripts/movementAssets.mjs) and the
// shared 3D line.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const current = JSON.parse(
  readFileSync(join(process.cwd(), 'dist', 'bundle-size.json'), 'utf8')
);
const baselinePath = process.argv[2];
const baseline =
  baselinePath && existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : null;

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const signedKb = (b) => `${b >= 0 ? '+' : '−'}${kb(Math.abs(b))}`;
// Under half a KB is compression noise, not a change worth reading as one.
const delta = (now, before) =>
  Math.abs(now - before) < 512 ? '±0.0 KB' : signedKb(now - before);

const row = (label, bytes, budgetKb, before, note) => {
  const over = bytes > budgetKb * 1024;
  const vsMain =
    before === undefined || before === null
      ? '_no baseline_'
      : `**${delta(bytes, before)}**`;
  return `| ${label} | **${kb(bytes)}** | ${budgetKb} KB | ${over ? '❌ over' : '✅'} | ${vsMain} | ${note} |`;
};

// A baseline cached before #756 has no `movements`; its squat figures sit
// under the legacy keys, so the squat still shows a delta on the first PR.
const LEGACY_SQUAT = { entry: 'squatEntry', total: 'squatTotal' };
const baselineFor = (id, key) =>
  baseline?.movements?.[id]?.[key] ??
  (id === 'squat' ? baseline?.[LEGACY_SQUAT[key]] : undefined);

const lines = [
  '<!-- bundle-size-report -->',
  '## Bundle size',
  '',
  '| | Gzipped | Budget | | Δ vs main | |',
  '| --- | ---: | ---: | :-: | ---: | --- |',
  row(
    'Entry',
    current.entry,
    current.entryBudgetKb,
    baseline?.entry,
    'ships on first paint'
  ),
  row(
    'Total',
    current.total,
    current.budgetKb,
    baseline?.total,
    'everything the dashboard can reach'
  ),
  // Each movement tool's rows. A tool the baseline does not have reads
  // undefined, which row() already renders as no delta.
  ...Object.entries(current.movements ?? {}).flatMap(([id, m]) => [
    row(
      `${m.title} entry`,
      m.entry,
      m.entryBudgetKb,
      baselineFor(id, 'entry'),
      `first paint of ${m.route}`
    ),
    row(
      `${m.title} total`,
      m.total,
      m.totalBudgetKb,
      baselineFor(id, 'total'),
      `tool files ${m.route} reaches`
    ),
  ]),
  // three.js + the anatomy scene, shared by every tool and lazy after its
  // data. It keeps the squat3d keys it had when the squat was the only tool.
  ...(current.squat3d === undefined
    ? []
    : [
        row(
          '3D (shared)',
          current.squat3d,
          current.squat3dBudgetKb,
          baseline?.squat3d,
          'three.js + scene, lazy'
        ),
      ]),
];

if (!baseline) {
  lines.push('', '_No main-branch baseline available for comparison._');
} else if (baseline.entry === undefined) {
  lines.push(
    '',
    `_The main baseline predates the entry budget (#331), so only the total is comparable — main total ${kb(baseline.total)}._`
  );
} else {
  lines.push(
    '',
    `_Main baseline: entry ${kb(baseline.entry)}, total ${kb(baseline.total)}._`
  );
}

// Entry assets are the ones worth eyeballing, so mark them in the breakdown.
const entryFiles = new Set((current.entryAssets ?? []).map((a) => a.file));
lines.push(
  '',
  '<details><summary>Per-asset breakdown</summary>',
  '',
  '▪ = ships on first paint',
  '',
  '| | Asset | Gzipped |',
  '| :-: | --- | ---: |',
  ...current.assets.map(
    (a) =>
      `| ${entryFiles.has(a.file) ? '▪' : ''} | \`${a.file}\` | ${kb(a.gzip)} |`
  ),
  '',
  '</details>'
);

console.log(lines.join('\n'));
