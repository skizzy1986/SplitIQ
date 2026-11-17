// Analysis on the source-neutral series (utils/sessionSeries.js).

// Time in each zone. `zones` is derivePaceZones(cp) or deriveCyclingZones(ftp):
// bands are [wattsLow, wattsHigh) and the top band is open-ended, so rowing
// power above the AN ceiling still counts as AN. Only moving samples with a
// power reading count; moving time without one is reported as unpoweredS.
export function timeInZones(series, zones) {
  if (!series || !Array.isArray(zones) || !zones.length) return null;
  const watts = series.channels.watts;
  const moving = series.channels.moving;
  const seconds = zones.map(() => 0);
  let zonedS = 0;
  let unpoweredS = 0;
  const last = zones.length - 1;
  for (let i = 0; i < series.n; i += 1) {
    if (moving && !moving[i]) continue;
    const dt = series.dt[i];
    const w = watts ? watts[i] : null;
    if (w == null || w < 0) {
      unpoweredS += dt;
      continue;
    }
    let z = zones.findIndex(
      (band, k) => k < last && w >= band.wattsLow && w < band.wattsHigh
    );
    if (z === -1) z = w >= zones[last].wattsLow ? last : 0;
    seconds[z] += dt;
    zonedS += dt;
  }
  return {
    bands: zones.map((band, k) => ({
      zone: band.zone,
      key: band.key ?? band.zone,
      color: band.color,
      seconds: seconds[k],
      fraction: zonedS > 0 ? seconds[k] / zonedS : 0,
    })),
    zonedS,
    unpoweredS,
  };
}

// The zone holding more than half the zoned time, or null.
export function dominantZone(result) {
  if (!result || !(result.zonedS > 0)) return null;
  return result.bands.find((b) => b.fraction > 0.5) ?? null;
}
