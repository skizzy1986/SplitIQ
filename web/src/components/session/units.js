import { formatPace } from '../../utils/pace.js';

// How the session components print a figure with its unit. Value and unit
// are joined by a non-breaking space (and "/500 m" holds one too), so a
// narrow tile or table cell never strands a unit on a line of its own.
export const NBSP = '\u00a0';
export const withUnit = (value, unit) => `${value}${NBSP}${unit}`;

export const PACE_UNIT = `/500${NBSP}m`;
// The one exception: a pace may break before "/500 m". Held whole, it runs
// out of a summary tile on a desktop row of six.
export const paceText = (secs) => `${formatPace(secs)} ${PACE_UNIT}`;
export const wattsText = (w) => withUnit(Math.round(w), 'W');
export const bpmText = (hr) => withUnit(Math.round(hr), 'bpm');
export const rateText = (rate, sport) =>
  withUnit(Math.round(rate), sport === 'erg' ? 'spm' : 'rpm');
export const speedText = (kmh) => withUnit(kmh.toFixed(1), 'km/h');
export const kmText = (m) =>
  withUnit((m / 1000).toFixed(m >= 10_000 ? 1 : 2), 'km');
// Under a kilometre in metres (a split, a short selection), else kilometres.
export const distanceText = (m) =>
  m < 1000 ? withUnit(Math.round(m), 'm') : kmText(m);
