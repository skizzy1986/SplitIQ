// The squat as one movement config: everything the page and the 3D scene need
// to know about the lift, gathered from squat/constants/ without copying it.
// Plain data only (no functions, no React), so a second movement is a second
// file of the same shape. Consumed by squat/SquatApp.jsx. The field-by-field
// contract is docs/squat/MOVEMENT_CONFIG.md.
import {
  ROUTE_PATH,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
} from '../../squat/constants/page.js';
import { DATA_ASSET } from '../../squat/constants/dataAsset.js';
import { PHASES } from '../../squat/constants/phases.js';
import {
  REGION_NAMES,
  REGION_OF,
} from '../../squat/constants/muscleRegions.js';
import { MUSCLE_SYNONYMS } from '../../squat/constants/muscleSynonyms.js';
import {
  ACT_BANDS,
  HEAT_STOPS,
  TOP_N,
} from '../../squat/constants/activationBands.js';
import {
  GUIDE_PANES,
  MEASURED_PANE,
  METRICS_INTRO,
  PHASE_GUIDE,
  PHASES_INTRO,
} from '../../squat/constants/guide.js';
import {
  FORM_CHECK,
  FORM_CHECK_LABEL,
} from '../../squat/constants/formCheck.js';
import { METRICS_TABLE } from '../../squat/constants/metricsTable.js';
import { METHOD } from '../../squat/constants/method.js';
import { REFERENCES } from '../../squat/constants/references.js';
import { MV_TABLE } from '../../squat/constants/velocityTable.js';
import { ATTRIBUTION } from '../../squat/constants/attribution.js';
import { BARBELL } from '../../squat/constants/barbell.js';

export const SQUAT_MOVEMENT = Object.freeze({
  id: 'squat',
  route: Object.freeze({ path: ROUTE_PATH }),
  page: Object.freeze({ title: PAGE_TITLE, description: PAGE_DESCRIPTION }),
  dataAsset: DATA_ASSET,
  phases: PHASES,
  muscles: Object.freeze({
    regionNames: REGION_NAMES,
    regionOf: REGION_OF,
    synonyms: MUSCLE_SYNONYMS,
  }),
  activation: Object.freeze({
    bands: ACT_BANDS,
    heatStops: HEAT_STOPS,
    topN: TOP_N,
  }),
  guide: Object.freeze({
    panes: GUIDE_PANES,
    phasesIntro: PHASES_INTRO,
    phaseGuide: PHASE_GUIDE,
    metricsIntro: METRICS_INTRO,
    measuredPane: MEASURED_PANE,
  }),
  formCheck: Object.freeze({ label: FORM_CHECK_LABEL, items: FORM_CHECK }),
  metrics: METRICS_TABLE,
  method: METHOD,
  references: REFERENCES,
  velocity: MV_TABLE,
  attribution: ATTRIBUTION,
  equipment: Object.freeze({ bar: BARBELL }),
});
