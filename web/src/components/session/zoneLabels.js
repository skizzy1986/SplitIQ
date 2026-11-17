import { msg } from '@lingui/core/macro';

// Zone names by band key: rowing bands are keyed by their zone name, cycling
// bands by their Coggan level. UT2, UT1, AT, TR and AN are rowing terms and
// stay as they are in every language.
export const ZONE_MESSAGES = {
  Recovery: msg({ message: 'Recovery', comment: 'Rowing training zone' }),
  UT2: msg({ message: 'UT2', comment: 'Rowing zone; keep as is' }),
  UT1: msg({ message: 'UT1', comment: 'Rowing zone; keep as is' }),
  AT: msg({ message: 'AT', comment: 'Rowing zone; keep as is' }),
  TR: msg({ message: 'TR', comment: 'Rowing zone; keep as is' }),
  AN: msg({ message: 'AN', comment: 'Rowing zone; keep as is' }),
  active_recovery: msg({
    message: 'Active recovery',
    comment: 'Cycling power level (Coggan Z1)',
  }),
  endurance: msg({
    message: 'Endurance',
    comment: 'Cycling power level (Coggan Z2)',
  }),
  tempo: msg({ message: 'Tempo', comment: 'Cycling power level (Coggan Z3)' }),
  threshold: msg({
    message: 'Threshold',
    comment: 'Cycling power level (Coggan Z4)',
  }),
  vo2max: msg({
    message: 'VO2 max',
    comment: 'Cycling power level (Coggan Z5)',
  }),
  anaerobic: msg({
    message: 'Anaerobic capacity',
    comment: 'Cycling power level (Coggan Z6)',
  }),
  neuromuscular: msg({
    message: 'Neuromuscular power',
    comment: 'Cycling power level (Coggan Z7)',
  }),
};

// "UT2" for rowing; "Z2 Endurance" for cycling, whose zone ids are bare.
export function zoneLabel(i18n, band) {
  const key = band.key ?? band.zone;
  const message = ZONE_MESSAGES[key];
  const name = message ? i18n._(message) : band.zone;
  return key === band.zone ? name : `${band.zone} ${name}`;
}
