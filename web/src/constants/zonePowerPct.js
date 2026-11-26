// Rowing pace-zone bounds as fractions of Critical Power. This is the single
// source for derivePaceZones (trainingConfig.js) and classifyZone (pace.js), so
// the classifier cannot drift from the bands the UI draws.
//
// Half-open [pctLow, pctHigh). The last band still classifies everything at or
// above its pctLow, including efforts above pctHigh — classifyZone has always
// returned AN for every effort at or above 105% CP.
//
// The fractions are the existing SplitIQ rowing bands, moved here from
// trainingConfig.js. Each colour is a THEME token; Recovery was a raw '#666'
// (#819, slice S0).
import { THEME } from './theme.js';

export const ZONE_POWER_PCT = [
  { zone: 'Recovery', color: THEME.zoneRecovery, pctLow: 0, pctHigh: 0.55 },
  { zone: 'UT2', color: THEME.accent, pctLow: 0.55, pctHigh: 0.7 },
  { zone: 'UT1', color: THEME.positive, pctLow: 0.7, pctHigh: 0.8 },
  { zone: 'AT', color: THEME.caution, pctLow: 0.8, pctHigh: 0.9 },
  { zone: 'TR', color: THEME.warning, pctLow: 0.9, pctHigh: 1.05 },
  { zone: 'AN', color: THEME.critical, pctLow: 1.05, pctHigh: 1.3 },
];
