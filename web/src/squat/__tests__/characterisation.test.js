import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '../SquatApp.jsx';
import { PHASES } from '../constants/phases.js';
import { REGION_NAMES, REGION_OF } from '../constants/muscleRegions.js';
import { ACT_BANDS, HEAT_STOPS } from '../constants/activationBands.js';
import {
  GUIDE_PANES,
  MEASURED_PANE,
  METRICS_INTRO,
  PHASE_GUIDE,
  PHASES_INTRO,
} from '../constants/guide.js';
import { FORM_CHECK, FORM_CHECK_LABEL } from '../constants/formCheck.js';
import { METRICS_TABLE } from '../constants/metricsTable.js';
import { METHOD } from '../constants/method.js';
import { REFERENCES } from '../constants/references.js';
import { ATTRIBUTION } from '../constants/attribution.js';
import { formatSquatHash, parseSquatHash } from '../utils/squatHash.js';

// CHARACTERISATION PINS for R12 (#440): the squat's data moves behind a
// movement config, and none of what a visitor sees may change with it. Every
// expected value in fixtures/characterisation.json was generated from main
// before the extraction, not typed. A failure here means the extraction changed
// content, not that the fixture needs regenerating.
const PINNED = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/squat/__tests__/fixtures/characterisation.json'),
    'utf8'
  )
);

const sha256 = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('squat content is unchanged by the movement-config extraction', () => {
  it('keeps the five phases, in order, with their headings and jump times', () => {
    expect(
      PHASES.map(({ index, id, name, heading, goto }) => ({
        index,
        id,
        name,
        heading,
        goto,
      }))
    ).toEqual(PINNED.phases);
  });

  it('keeps the eleven regions and every muscle in its region', () => {
    expect(REGION_NAMES).toEqual(PINNED.regionNames);
    expect(REGION_OF).toHaveLength(118);
    expect(sha256(REGION_OF)).toBe(PINNED.regionOfSha256);
  });

  it('keeps the activation bands and the heat ramp stops', () => {
    expect(ACT_BANDS).toEqual(PINNED.actBands);
    expect(HEAT_STOPS).toEqual(PINNED.heatStops);
  });

  it('keeps every prose export byte-identical', () => {
    expect({
      guide: sha256({
        GUIDE_PANES,
        PHASES_INTRO,
        PHASE_GUIDE,
        METRICS_INTRO,
        MEASURED_PANE,
      }),
      formCheck: sha256({ FORM_CHECK_LABEL, FORM_CHECK }),
      metrics: sha256(METRICS_TABLE),
      method: sha256(METHOD),
      references: sha256(REFERENCES),
      attribution: sha256(ATTRIBUTION),
    }).toEqual(PINNED.proseSha256);
  });

  it('keeps the page title and description', () => {
    expect(PAGE_TITLE).toBe(PINNED.page.title);
    expect(PAGE_DESCRIPTION).toBe(PINNED.page.description);
  });

  // Copied from shareLinks.golden.test.jsx: links already out in the world.
  it.each(Object.entries(PINNED.hashes))(
    'a pre-change share link (%s) decodes to the same view and re-encodes to itself',
    (hash, decoded) => {
      expect(parseSquatHash(hash)).toEqual(decoded);
      expect(formatSquatHash(parseSquatHash(hash))).toBe(hash);
    }
  );
});
