import { ZONE_POWER_PCT } from '../constants/zonePowerPct.js';

export function wattsToPace500(watts) {
  return 500 * (2.8 / watts) ** (1 / 3);
}

export function pace500ToWatts(secs) {
  return 2.8 / (secs / 500) ** 3;
}

export function formatPace(secs) {
  if (secs == null || secs === 0 || Number.isNaN(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function classifyZone(watts, cp) {
  if (watts == null) return null;
  if (!Number.isFinite(cp) || cp <= 0) return null;
  const pct = watts / cp;
  for (const band of ZONE_POWER_PCT) {
    if (pct < band.pctHigh) return band.zone;
  }
  return ZONE_POWER_PCT[ZONE_POWER_PCT.length - 1].zone;
}
