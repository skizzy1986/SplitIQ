// Pure workout and interval model ported from the v10 prototype (js1.js,
// js3.js). Zones come from derivePaceZones / classifyZone / timeInZones —
// this file does not keep a second zone table.
import { derivePaceZones } from '../constants/trainingConfig.js';
import {
  classifyZone,
  formatPace,
  pace500ToWatts,
  wattsToPace500,
} from '../utils/pace.js';
import { timeInZones } from '../utils/sessionAnalysis.js';

export const BAND_W = 5;
// v10 keeps a 2 W latch past the ±5 W band so the badge does not flicker on
// the edge. The under/over figure is the gap from the band edge, not the target.
export const BAND_LATCH_W = 2;
export const MAX_INTERVALS = 50;
export const MIN_SPLIT_S = 20;
export const MAX_SPLIT_S = 5400; // 1:30:00
export const MAX_WORK_TIME_S = 3599; // 59:59
export const MIN_DIST_M = 100;
export const MAX_REST_S = 595; // 9:55
export const PLACEHOLDER_CP_W = 200;
export const DEFAULT_REST_S = 120;
export const RATE_MIN = 16;
export const RATE_MAX = 44;

export const INTERVAL_STEPS = {
  workM: 250,
  workS: 30,
  rest: 15,
  watts: 5,
  rate: 1,
};

export const TERMS = {
  rowing: {
    spm: 'spm',
    spmCol: 'SPM',
    rate: 'Rate',
    split: 'Split',
    splitPace: '/500m',
    splitAvg: 'Split avg',
    drag: 'Drag factor',
    rest: 'Rest',
    easy: 'Easy row',
    interval: 'Interval',
    intervals: 'Intervals',
    piece: 'Piece',
    stroke: 'Stroke',
    watts: 'Watts',
  },
  plain: {
    spm: 'strokes/min',
    spmCol: 'S/MIN',
    rate: 'Rate',
    split: 'Split',
    splitPace: 'pace /500 m',
    splitAvg: 'Split avg',
    drag: 'Resistance',
    rest: 'Rest',
    easy: 'Easy row',
    interval: 'Interval',
    intervals: 'Intervals',
    piece: 'Workout',
    stroke: 'Stroke',
    watts: 'Watts',
  },
};

export function term(key, mode = 'rowing') {
  return (TERMS[mode] || TERMS.rowing)[key] || key;
}

export { classifyZone, formatPace, pace500ToWatts, wattsToPace500 };

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  if (h) {
    return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  }
  return `${m}:${String(x).padStart(2, '0')}`;
}

export function formatMetres(metres) {
  return Math.round(metres).toLocaleString('en-AU');
}

export function formatDeltaW(delta) {
  if (!Number.isFinite(delta) || delta === 0) return '0';
  if (delta > 0) return `+${delta}`;
  return `\u2212${Math.abs(delta)}`;
}

export function midZoneWatts(cp, zone = 'UT2') {
  const n = Number(cp);
  if (!Number.isFinite(n) || n <= 0) return null;
  const bands = derivePaceZones(n);
  const band = bands.find((b) => b.zone === zone);
  if (!band) return null;
  return Math.round((band.wattsLow + band.wattsHigh) / 2);
}

export function resolvedCp(cp) {
  const n = Number(cp);
  if (Number.isFinite(n) && n > 0) return { cp: n, placeholder: false };
  return { cp: PLACEHOLDER_CP_W, placeholder: true };
}

export function defaultInterval(partial = {}, cp = null) {
  const { cp: wattsCp } = resolvedCp(cp);
  const watts =
    partial.watts != null
      ? partial.watts
      : (midZoneWatts(wattsCp, partial.zone || 'UT2') ??
        midZoneWatts(PLACEHOLDER_CP_W, 'UT2'));
  return {
    work: partial.work ?? 1000,
    unit: partial.unit || 'm',
    rest: partial.rest ?? DEFAULT_REST_S,
    watts,
    rate: partial.rate ?? 22,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function intervalsOf(workout) {
  if (!workout || workout.type !== 'int') return [];
  if (workout.ints && workout.ints.length)
    return workout.ints.map((iv) => ({ ...iv }));
  const n = workout.reps || 4;
  const seed = defaultInterval(workout);
  const list = Array.from({ length: n }, () => ({ ...seed }));
  if (list.length) list[list.length - 1].rest = 0;
  return list;
}

export function withIntervals(workout, ints) {
  const next = { ...workout, type: 'int', ints: ints.map((iv) => ({ ...iv })) };
  next.reps = next.ints.length;
  return next;
}

export function currentInterval(workout, intervalNo) {
  const list = intervalsOf(workout);
  if (!list.length) return null;
  const i = Math.min(Math.max((intervalNo || 1) - 1, 0), list.length - 1);
  return list[i];
}

export function intervalBand(interval) {
  if (!interval || interval.watts == null) return null;
  return {
    lo: interval.watts - BAND_W,
    hi: interval.watts + BAND_W,
    target: interval.watts,
    rate: interval.rate,
  };
}

export function bandForInterval(workout, intervalNo) {
  if (!workout) return null;
  if (workout.type === 'int') {
    return intervalBand(currentInterval(workout, intervalNo));
  }
  if (!workout.zone) return null;
  const { cp } = resolvedCp(workout.cp);
  const bands = derivePaceZones(cp);
  const band = bands.find((b) => b.zone === workout.zone);
  if (!band) return null;
  return {
    lo: band.wattsLow,
    hi: band.wattsHigh,
    target: Math.round((band.wattsLow + band.wattsHigh) / 2),
    zone: workout.zone,
  };
}

export function classifyBand(watts, band) {
  if (!band) {
    return {
      dir: 'none',
      x: 0,
      arrow: '',
      word: 'No target set',
      label: 'No target set',
    };
  }
  const w = Math.round(watts);
  if (w < band.lo - BAND_LATCH_W) {
    const x = band.lo - w;
    const word = 'under';
    const label =
      band.target != null
        ? `\u25bc ${x} W under ${band.target} W`
        : `\u25bc ${x} W under band`;
    return { dir: 'under', x, arrow: '\u25bc', word, label };
  }
  if (w > band.hi + BAND_LATCH_W) {
    const x = w - band.hi;
    const word = 'over';
    const label =
      band.target != null
        ? `\u25b2 ${x} W over ${band.target} W`
        : `\u25b2 ${x} W over band`;
    return { dir: 'over', x, arrow: '\u25b2', word, label };
  }
  const label =
    band.target != null
      ? `In band \u00b7 ${band.target} W`
      : `In band \u00b7 ${band.zone} ${band.lo}\u2013${band.hi} W`;
  return { dir: 'in', x: 0, arrow: '', word: 'In band', label };
}

export function planCount(workout) {
  if (!workout) return null;
  if (workout.type === 'time' || workout.type === 'dist') {
    return Math.ceil(workout.total / workout.split);
  }
  if (workout.type === 'int') return intervalsOf(workout).length;
  return null;
}

export function planLength(workout, index) {
  if (workout.type === 'time') {
    return {
      unit: 's',
      value: Math.min(workout.split, workout.total - index * workout.split),
      text: formatDuration(
        Math.min(workout.split, workout.total - index * workout.split)
      ),
    };
  }
  if (workout.type === 'dist') {
    const value = Math.min(
      workout.split,
      workout.total - index * workout.split
    );
    return { unit: 'm', value, text: `${formatMetres(value)} m` };
  }
  if (workout.type === 'int') {
    const iv = intervalsOf(workout)[index] || defaultInterval(workout);
    if (iv.unit === 'm') {
      return { unit: 'm', value: iv.work, text: `${formatMetres(iv.work)} m` };
    }
    return { unit: 's', value: iv.work, text: formatDuration(iv.work) };
  }
  return {
    unit: 's',
    value: workout.split,
    text: formatDuration(workout.split),
  };
}

export function workoutTitle(workout, mode = 'rowing') {
  if (workout.type === 'time') {
    return `${formatDuration(workout.total)} \u00b7 ${formatDuration(workout.split)} splits`;
  }
  if (workout.type === 'dist') {
    return `${formatMetres(workout.total)} m \u00b7 ${formatMetres(workout.split)} m splits`;
  }
  if (workout.type === 'int') {
    const list = intervalsOf(workout);
    if (!list.length) return term('intervals', mode);
    const workSame = list.every(
      (x) => x.work === list[0].work && x.unit === list[0].unit
    );
    const restSame =
      list.length === 1 ||
      list.slice(0, -1).every((x) => x.rest === list[0].rest);
    if (workSame && restSame) {
      const work =
        list[0].unit === 'm'
          ? `${formatMetres(list[0].work)} m`
          : formatDuration(list[0].work);
      return `${list.length} \u00d7 ${work} \u00b7 ${formatDuration(list[0].rest)} rest`;
    }
    return `${list.length} variable ${term('intervals', mode).toLowerCase()}`;
  }
  return `Just Row \u00b7 ${formatDuration(workout.split)} splits`;
}

export function validateWorkout(workout) {
  const errors = [];
  if (workout.type === 'time') {
    if (workout.split < MIN_SPLIT_S) {
      errors.push('Splits must be at least 0:20 on the PM5.');
    }
    if (workout.split > MAX_SPLIT_S) {
      errors.push('Splits max out at 1:30:00 on the PM5.');
    }
    if (workout.split > workout.total) {
      errors.push('A split can\u2019t be longer than the piece.');
    }
    const n = planCount(workout);
    if (n > MAX_INTERVALS) {
      const minSplit = Math.ceil(workout.total / MAX_INTERVALS / 5) * 5;
      errors.push(
        `That\u2019s ${n} splits. The PM5 takes ${MAX_INTERVALS} at most, so make splits at least ${formatDuration(minSplit)}.`
      );
    }
  }
  if (workout.type === 'dist') {
    if (workout.split < MIN_DIST_M) {
      errors.push('Splits must be at least 100 m.');
    }
    if (workout.split > workout.total) {
      errors.push('A split can\u2019t be longer than the piece.');
    }
    const n = planCount(workout);
    if (n > MAX_INTERVALS) {
      errors.push(
        `That\u2019s ${n} splits; the PM5 takes ${MAX_INTERVALS} at most.`
      );
    }
  }
  if (workout.type === 'int') {
    const list = intervalsOf(workout);
    if (list.length > MAX_INTERVALS) {
      errors.push(
        `That\u2019s ${list.length} intervals. The PM5 takes ${MAX_INTERVALS} at most.`
      );
    }
    if (!list.length) errors.push('Add at least one interval.');
    list.forEach((iv, i) => {
      const n = i + 1;
      if (
        iv.unit === 's' &&
        (iv.work < MIN_SPLIT_S || iv.work > MAX_WORK_TIME_S)
      ) {
        errors.push(`Interval ${n}: timed work must be 0:20 to 59:59.`);
      }
      if (iv.unit === 'm' && iv.work < MIN_DIST_M) {
        errors.push(`Interval ${n}: distance work starts at 100 m.`);
      }
      if (iv.rest > MAX_REST_S) {
        errors.push(`Interval ${n}: rest maxes out at 9:55 on the PM5.`);
      }
    });
  }
  return errors;
}

export function addInterval(workout, interval) {
  const list = intervalsOf(workout);
  if (list.length >= MAX_INTERVALS) return withIntervals(workout, list);
  const last = list[list.length - 1];
  const next = list.map((iv) => ({ ...iv }));
  if (last && last.rest === 0) next[next.length - 1].rest = DEFAULT_REST_S;
  const added = {
    ...(interval || (last ? { ...last } : defaultInterval(workout))),
  };
  added.rest = 0;
  next.push(added);
  return withIntervals(workout, next);
}

export function removeInterval(workout, index) {
  const list = intervalsOf(workout);
  if (list.length <= 1) return withIntervals(workout, list);
  return withIntervals(
    workout,
    list.filter((_, i) => i !== index)
  );
}

export function moveInterval(workout, index, delta) {
  const list = intervalsOf(workout);
  const j = index + delta;
  if (j < 0 || j >= list.length) return withIntervals(workout, list);
  const next = list.map((iv) => ({ ...iv }));
  const tmp = next[index];
  next[index] = next[j];
  next[j] = tmp;
  return withIntervals(workout, next);
}

export function updateInterval(workout, index, patch) {
  const list = intervalsOf(workout);
  if (index < 0 || index >= list.length) return withIntervals(workout, list);
  const next = list.map((iv, i) =>
    i === index ? { ...iv, ...patch } : { ...iv }
  );
  return withIntervals(workout, next);
}

export function setIntervalUnit(workout, index, unit) {
  if (unit !== 'm' && unit !== 's')
    return withIntervals(workout, intervalsOf(workout));
  const list = intervalsOf(workout);
  const iv = list[index];
  if (!iv || iv.unit === unit) return withIntervals(workout, list);
  return updateInterval(workout, index, {
    unit,
    work: unit === 'm' ? 1000 : 480,
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function stepIntervalField(workout, index, field, delta) {
  const list = intervalsOf(workout);
  const iv = list[index];
  if (!iv) return withIntervals(workout, list);
  const min = {
    work: iv.unit === 'm' ? MIN_DIST_M : MIN_SPLIT_S,
    rest: 0,
    watts: 50,
    rate: RATE_MIN,
  }[field];
  const max = {
    work: iv.unit === 'm' ? 99999 : MAX_WORK_TIME_S,
    rest: MAX_REST_S,
    watts: 800,
    rate: RATE_MAX,
  }[field];
  if (min == null) return withIntervals(workout, list);
  return updateInterval(workout, index, {
    [field]: clamp(iv[field] + delta, min, max),
  });
}

export function createWorkout(partial = {}, cp = null) {
  const base = {
    type: 'time',
    total: 1800,
    split: 180,
    reps: 4,
    work: 1000,
    unit: 'm',
    rest: DEFAULT_REST_S,
    zone: 'UT2',
    name: '',
    cp,
  };
  const workout = { ...base, ...clone(partial) };
  if (workout.cp == null) workout.cp = cp;
  if (workout.type === 'int') {
    const ints =
      workout.ints && workout.ints.length
        ? workout.ints.map((iv) => defaultInterval(iv, workout.cp))
        : intervalsOf(workout);
    return withIntervals(workout, ints);
  }
  return workout;
}

export function currentSplitFrom({
  splitTime = 0,
  metres = 0,
  n,
  splits = [],
  pace,
  watts,
  spm,
  hr,
}) {
  const t = splitTime;
  const d = metres;
  const p = d > 1 ? (t / d) * 500 : pace;
  return {
    n: n ?? splits.length + 1,
    time: t,
    m: d,
    pace: p,
    w: d > 1 ? pace500ToWatts(p) : watts,
    spm,
    hr,
  };
}

export function totalsFrom(splits, current, phase) {
  const done = splits || [];
  const all =
    phase === 'work' && current && current.time > 0
      ? done.concat([current])
      : done;
  const time = all.reduce((a, x) => a + x.time, 0);
  const m = all.reduce((a, x) => a + x.m, 0);
  const pace = m > 0 ? (time / m) * 500 : 0;
  return {
    time,
    m,
    pace,
    w: pace ? pace500ToWatts(pace) : 0,
    spm: time ? all.reduce((a, x) => a + x.spm * x.time, 0) / time : 0,
    hr: time ? all.reduce((a, x) => a + x.hr * x.time, 0) / time : 0,
    rest: done.reduce((a, x) => a + (x.rest || 0), 0),
    n: 'All',
  };
}

export const SPLIT_COLUMNS = {
  watts: ['#', 'Time', 'Metres', 'W', '/500m', 'SPM', 'HR', '\u0394W'],
  pace: ['#', 'Time', 'Metres', '/500m', 'W', 'SPM', 'HR', '\u0394W'],
};

export function splitColumnLabels(units = 'watts', mode = 'rowing') {
  const headers = {
    Time: 'TIME',
    Metres: 'METRES',
    '\u0394W': '\u0394W',
    SPM: term('spmCol', mode),
  };
  return (SPLIT_COLUMNS[units] || SPLIT_COLUMNS.watts).map((col) => ({
    id: col,
    label: headers[col] || col,
  }));
}

export function splitRowCells(row, kind, prev) {
  const cells = {
    '#': row.n,
    Time: formatDuration(row.time),
    Metres: formatMetres(row.m),
    '/500m': formatPace(
      row.pace == null || !Number.isFinite(row.pace) || row.pace > 600
        ? null
        : row.pace
    ),
    W: Math.round(row.w),
    SPM: Math.round(row.spm),
    HR: Math.round(row.hr),
    '\u0394W': prev ? formatDeltaW(Math.round(row.w - prev.w)) : '\u2014',
  };
  if (kind === 'sum') {
    cells['#'] = 'All';
    cells['\u0394W'] = '';
  }
  return cells;
}

export function shapeSplitTable({
  workout,
  splits = [],
  current,
  phase,
  units = 'watts',
  summary = false,
  skip = 0,
  terms = 'rowing',
} = {}) {
  const planned = planCount(workout);
  const showRest = workout && workout.type === 'int' && summary;
  const columns = (SPLIT_COLUMNS[units] || SPLIT_COLUMNS.watts).filter(
    (col) => !showRest || col !== '\u0394W'
  );
  const headers = splitColumnLabels(units, terms).filter((h) =>
    columns.includes(h.id)
  );
  if (showRest) headers.push({ id: 'REST', label: 'REST' });

  const rows = [];
  const totals = totalsFrom(splits, current, phase);
  if (totals.time > 0) {
    const cells = splitRowCells(totals, 'sum');
    rows.push({
      kind: 'sum',
      cells,
      rest: showRest ? formatDuration(totals.rest) : null,
    });
  }
  const pending = [];
  splits.forEach((s, i) =>
    pending.push({ kind: 'split', row: s, prev: splits[i - 1] })
  );
  if (phase === 'work' && !summary && current) {
    pending.push({
      kind: 'now',
      row: current,
      prev: splits[splits.length - 1],
    });
  }
  if (!summary && planned) {
    for (let i = pending.length; i < planned; i += 1) {
      pending.push({ kind: 'plan', plan: i });
    }
  }

  pending.forEach((item, i) => {
    if (item.kind === 'split' && i < skip) return;
    if (item.kind === 'plan') {
      const cells = {
        '#': item.plan + 1,
        Time: '\u00b7',
        Metres: '\u00b7',
        '/500m': '\u00b7',
        W: '\u00b7',
        SPM: '\u00b7',
        HR: '\u00b7',
        '\u0394W': '\u00b7',
      };
      const len = planLength(workout, item.plan);
      const iv =
        workout.type === 'int' ? intervalsOf(workout)[item.plan] : null;
      if (workout.type === 'dist' || (iv && iv.unit === 'm')) {
        cells.Metres = String(len.text).replace(' m', '');
      } else {
        cells.Time = len.text;
      }
      rows.push({ kind: 'plan', cells, rest: null, intervalIndex: item.plan });
      return;
    }
    const cells = splitRowCells(item.row, '', item.prev);
    if (item.kind === 'now') cells['#'] = `\u25b8${cells['#']}`;
    rows.push({
      kind: item.kind,
      cells,
      rest:
        showRest && item.row.rest != null
          ? formatDuration(item.row.rest)
          : null,
      band:
        item.row.w != null && workout
          ? classifyBand(
              item.row.w,
              bandForInterval(
                workout,
                item.kind === 'now'
                  ? (current && current.n) || splits.length + 1
                  : item.row.n
              )
            )
          : null,
    });
  });

  return { columns, headers, rows, showRest };
}

// Adapter so timeInZones can be called from simple [{ watts, dt }] samples.
export function samplesToSeries(samples) {
  const n = samples.length + 1;
  return {
    n,
    live: samples.map(() => true).concat([false]),
    dt: samples.map((s) => s.dt).concat([0]),
    channels: { watts: samples.map((s) => s.watts).concat([null]) },
  };
}

export function zoneTimeFromSamples(samples, cp) {
  if (!Number.isFinite(cp) || cp <= 0) return null;
  return timeInZones(samplesToSeries(samples), derivePaceZones(cp));
}

export function csafePreview(workout, mode = 'rowing') {
  const lines = [];
  if (workout.type === 'int') {
    const list = intervalsOf(workout);
    lines.push({
      key: 'Workout',
      value: `Variable ${term('intervals', mode).toLowerCase()} (${list.length})`,
      command: 'CSAFE_PM_SET_WORKOUTTYPE 0x01',
    });
    list.forEach((iv, i) => {
      const len =
        iv.unit === 'm'
          ? `${formatMetres(iv.work)} m`
          : formatDuration(iv.work);
      lines.push({
        key: `Interval ${i + 1}`,
        value: `${len} \u00b7 rest ${formatDuration(iv.rest)} \u00b7 ${iv.watts} W`,
        command:
          'SET_WORKOUTDURATION 0x03 \u00b7 SET_RESTDURATION 0x04 \u00b7 SETPOWER 0x34',
      });
    });
  } else {
    const typ = {
      time: 'Fixed time with splits',
      dist: 'Fixed distance with splits',
      justrow: 'Just Row with splits',
    }[workout.type];
    const band = bandForInterval(workout, 1);
    lines.push({
      key: 'Workout',
      value: typ,
      command: 'CSAFE_PM_SET_WORKOUTTYPE 0x01',
    });
    if (workout.type === 'time') {
      lines.push({
        key: 'Duration',
        value: formatDuration(workout.total),
        command: 'CSAFE_PM_SET_WORKOUTDURATION 0x03',
      });
    }
    if (workout.type === 'dist') {
      lines.push({
        key: 'Distance',
        value: `${formatMetres(workout.total)} m`,
        command: 'CSAFE_PM_SET_WORKOUTDURATION 0x03',
      });
    }
    const n = planCount(workout);
    const every =
      workout.type === 'dist'
        ? `${formatMetres(workout.split)} m`
        : formatDuration(workout.split);
    lines.push({
      key: 'Splits',
      value: `every ${every} (${n} splits)`,
      command: 'CSAFE_PM_SET_SPLITDURATION 0x05',
    });
    if (band && band.target != null) {
      lines.push({
        key: 'Power goal',
        value: `${band.target} W pace boat`,
        command: 'CSAFE_SETPOWER 0x34 (or PM_SET_TARGETAVGWATTS 0x15)',
      });
    }
  }
  lines.push({
    key: 'Clock',
    value: 'date and time synced for the logbook',
    command: 'CSAFE_PM_SET_DATETIME 0x22',
  });
  lines.push({
    key: 'Screen',
    value: 'straight to Ready to row',
    command: 'CSAFE_PM_SET_SCREENSTATE 0x13',
  });
  return lines;
}
