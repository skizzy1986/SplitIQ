import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SQUAT_MOVEMENT } from '../movement.js';
import {
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  ROUTE_PATH,
} from '../../../squat/constants/page.js';
import { DATA_ASSET } from '../../../squat/constants/dataAsset.js';
import { PHASES } from '../../../squat/constants/phases.js';
import {
  REGION_NAMES,
  REGION_OF,
} from '../../../squat/constants/muscleRegions.js';
import { MUSCLE_SYNONYMS } from '../../../squat/constants/muscleSynonyms.js';
import {
  ACT_BANDS,
  HEAT_STOPS,
  TOP_N,
} from '../../../squat/constants/activationBands.js';
import {
  GUIDE_PANES,
  MEASURED_PANE,
  METRICS_INTRO,
  PHASE_GUIDE,
  PHASES_INTRO,
} from '../../../squat/constants/guide.js';
import {
  FORM_CHECK,
  FORM_CHECK_LABEL,
} from '../../../squat/constants/formCheck.js';
import { METRICS_TABLE } from '../../../squat/constants/metricsTable.js';
import { METHOD } from '../../../squat/constants/method.js';
import { REFERENCES } from '../../../squat/constants/references.js';
import { MV_TABLE } from '../../../squat/constants/velocityTable.js';
import { ATTRIBUTION } from '../../../squat/constants/attribution.js';
import { BARBELL } from '../../../squat/constants/barbell.js';
import {
  canonicalMovementUrl,
  movementForPath,
} from '../../../utils/movementRoute.js';

const ROOT = process.cwd();
const SOURCE = readFileSync(
  join(ROOT, 'src/movements/squat/movement.js'),
  'utf8'
);

// Every value reachable from the config, with its path, for the plain-data walk.
function walk(value, path, out) {
  out.push([path, value]);
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, out);
  }
  return out;
}

describe('SQUAT_MOVEMENT', () => {
  it('is plain data all the way down: objects, arrays and primitives only', () => {
    const odd = walk(SQUAT_MOVEMENT, 'SQUAT_MOVEMENT', []).filter(
      ([, v]) =>
        !(
          v === null ||
          ['string', 'number', 'boolean'].includes(typeof v) ||
          Array.isArray(v) ||
          (typeof v === 'object' &&
            Object.getPrototypeOf(v) === Object.prototype)
        )
    );
    expect(odd.map(([p]) => p)).toEqual([]);
  });

  it('is frozen, and so is every wrapper it builds', () => {
    expect(Object.isFrozen(SQUAT_MOVEMENT)).toBe(true);
    for (const key of [
      'route',
      'page',
      'muscles',
      'activation',
      'guide',
      'formCheck',
      'equipment',
    ]) {
      expect(Object.isFrozen(SQUAT_MOVEMENT[key]), key).toBe(true);
    }
  });

  it('imports nothing but the squat constants (no React, no logic)', () => {
    const from = [...SOURCE.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(from.length).toBeGreaterThan(0);
    for (const f of from) expect(f).toMatch(/^\.\.\/\.\.\/squat\/constants\//);
    expect(SOURCE).not.toMatch(/\bimport\(/);
  });

  // Identity, not equality: the config re-exports the constants modules; it
  // never copies them, so there is one source for every value (D-a).
  it('re-exports each constant itself, not a copy', () => {
    const M = SQUAT_MOVEMENT;
    expect(M.id).toBe('squat');
    expect(M.route.path).toBe(ROUTE_PATH);
    expect(M.page.title).toBe(PAGE_TITLE);
    expect(M.page.description).toBe(PAGE_DESCRIPTION);
    expect(M.dataAsset).toBe(DATA_ASSET);
    expect(M.phases).toBe(PHASES);
    expect(M.muscles.regionNames).toBe(REGION_NAMES);
    expect(M.muscles.regionOf).toBe(REGION_OF);
    expect(M.muscles.synonyms).toBe(MUSCLE_SYNONYMS);
    expect(M.activation.bands).toBe(ACT_BANDS);
    expect(M.activation.heatStops).toBe(HEAT_STOPS);
    expect(M.activation.topN).toBe(TOP_N);
    expect(M.guide.panes).toBe(GUIDE_PANES);
    expect(M.guide.phasesIntro).toBe(PHASES_INTRO);
    expect(M.guide.phaseGuide).toBe(PHASE_GUIDE);
    expect(M.guide.metricsIntro).toBe(METRICS_INTRO);
    expect(M.guide.measuredPane).toBe(MEASURED_PANE);
    expect(M.formCheck.label).toBe(FORM_CHECK_LABEL);
    expect(M.formCheck.items).toBe(FORM_CHECK);
    expect(M.metrics).toBe(METRICS_TABLE);
    expect(M.method).toBe(METHOD);
    expect(M.references).toBe(REFERENCES);
    expect(M.velocity).toBe(MV_TABLE);
    expect(M.attribution).toBe(ATTRIBUTION);
    expect(M.equipment.bar).toBe(BARBELL);
  });

  it('carries the bar the scene drew before the extraction', () => {
    const fixture = JSON.parse(
      readFileSync(
        join(ROOT, 'src/anatomy/scene/__tests__/fixtures/barbell-squat.json'),
        'utf8'
      )
    );
    expect(SQUAT_MOVEMENT.equipment).toEqual(fixture.input);
  });

  // RouteRoot keeps its own '/squat' (dashboard first paint); the two must agree.
  it('names the route the dashboard router recognises', () => {
    const path = SQUAT_MOVEMENT.route.path;
    expect(movementForPath(path)).toBe(SQUAT_MOVEMENT.id);
    expect(movementForPath(`${path}/`)).toBe(SQUAT_MOVEMENT.id);
    expect(canonicalMovementUrl({ pathname: path })).toBeNull();
    expect(
      canonicalMovementUrl({
        pathname: `${path}/`,
        search: '?a=1',
        hash: '#t=1',
      })
    ).toBe(`${path}?a=1#t=1`);
  });

  it('is documented field by field', () => {
    const doc = readFileSync(
      join(ROOT, '../docs/squat/MOVEMENT_CONFIG.md'),
      'utf8'
    );
    const missing = Object.keys(SQUAT_MOVEMENT).filter(
      (k) => !doc.includes(`\`${k}\``)
    );
    expect(missing).toEqual([]);
  });
});
