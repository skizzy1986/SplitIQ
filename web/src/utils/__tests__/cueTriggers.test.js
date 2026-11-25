import { describe, expect, it } from 'vitest';
import {
  CHATTINESS,
  GO_DEBOUNCE_MS,
  HIT_TOLERANCE_W,
  VOICE_SPACING_MS,
  createCueState,
  detectCues,
} from '../cueTriggers.js';
import {
  bandForInterval,
  createWorkout,
} from '../../live-erg/intervalModel.js';
import { createSplitTracker, trackSample } from '../../live-erg/pm5Splits.js';
import { wattsToPace500 } from '../pace.js';

const WORK = 5; // intervalWorkDistance
const REST = 3; // intervalRest
const END = 10;

// One PM5 sample at wall-clock `t` ms. `m` metres and `e` elapsed seconds are
// the PM5's own segment clock.
function s(t, e, m, ws, extra = {}) {
  return {
    t,
    elapsedTime: e,
    distance: m,
    workoutState: ws,
    rowingState: 1,
    strokeRate: 24,
    pace500: Math.round(wattsToPace500(210) * 100),
    watts: 210,
    ...extra,
  };
}

function drive(workout, steps, chatter = 'standard') {
  let tracker = createSplitTracker();
  let state = createCueState();
  const out = [];
  for (const { t, ...sample } of steps) {
    tracker = trackSample(tracker, sample, workout);
    const r = detectCues(state, {
      sample,
      tracker,
      workout,
      nowMs: t,
      chatter,
    });
    state = r.state;
    out.push(...r.intents.map((i) => ({ t, ...i })));
  }
  return out;
}

const iv = (watts, rest, extra = {}) => ({
  work: 1000,
  unit: 'm',
  rest,
  watts,
  rate: 24,
  ...extra,
});
const twoByK = createWorkout({
  type: 'int',
  ints: [iv(210, 120), iv(210, 0)],
});

// 1000 m at `watts`, ending in rest, from wall time t0.
function interval(t0, watts, endState = REST) {
  const secs = (1000 / 500) * wattsToPace500(watts);
  const pace = Math.round(wattsToPace500(watts) * 100);
  return [
    s(t0, 0, 0, WORK, { watts, pace500: pace }),
    s(t0 + 1000, secs / 2, 500, WORK, { watts, pace500: pace }),
    s(t0 + 2000, secs, 1000, endState, { watts, pace500: pace }),
  ];
}

const named = (list, event) => list.filter((i) => i.event === event);

describe('cueTriggers: go (E1)', () => {
  it('says start on the first work edge and nothing while ready', () => {
    const out = drive(twoByK, [
      s(0, 0, 0, 0),
      s(500, 0, 0, 0),
      s(1000, 0, 0, WORK),
    ]);
    expect(out.map((i) => [i.event, i.line, i.t])).toEqual([
      ['go', 'start', 1000],
    ]);
    expect(out[0]).toMatchObject({
      priority: 0,
      firstEdge: true,
      voiced: true,
    });
  });

  it('names the interval after rest and calls the last one', () => {
    const three = createWorkout({
      type: 'int',
      ints: [iv(210, 60), iv(210, 60), iv(210, 0)],
    });
    const out = drive(three, [
      ...interval(0, 210),
      ...interval(70000, 210),
      ...interval(140000, 210).slice(0, 1),
    ]).filter((i) => i.event === 'go');
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ line: 'go', firstEdge: false });
    expect(out[1].lead).toEqual({ kind: 'of_n', n: 2, of: 3 });
    expect(out[2]).toMatchObject({ line: 'last' });
    expect(out[2].lead).toEqual({ kind: 'of_n', n: 3, of: 3 });
  });

  it('ignores a flicker back into work inside the debounce', () => {
    const out = drive(
      createWorkout({ type: 'time', total: 1800, split: 180 }),
      [
        s(0, 0, 0, WORK),
        s(500, 1, 3, REST),
        s(1000, 1.5, 4, WORK),
        s(GO_DEBOUNCE_MS + 2000, 9, 40, REST),
        s(GO_DEBOUNCE_MS + 2500, 9.5, 41, WORK),
      ]
    ).filter((i) => i.event === 'go');
    expect(out.map((i) => i.t)).toEqual([0, GO_DEBOUNCE_MS + 2500]);
    expect(out[1].line).toBe('go');
  });
});

describe('cueTriggers: rest and the verdict (E5, E10)', () => {
  it('opens rest with the rest length and a hit tone when the split is in the band', () => {
    const out = named(drive(twoByK, interval(0, 210)), 'rest');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      priority: 0,
      line: 'rest',
      tone: 'hit',
      restS: 120,
      voiced: true,
    });
    expect(out[0].lead).toEqual({ kind: 'rest_t', value: 120 });
  });

  it('uses the miss tone when the split is outside the band', () => {
    const out = named(drive(twoByK, interval(0, 180)), 'rest');
    expect(out[0].tone).toBe('miss');
  });

  it('judges hit within +/-5 W of the target, plus the 2 W latch', () => {
    expect(HIT_TOLERANCE_W).toBe(5);
    const tone = (w) => named(drive(twoByK, interval(0, w)), 'rest')[0].tone;
    // 1000 m at 216 W averages 217 W by the split row (pace rounding).
    expect(tone(214)).toBe('hit');
    expect(tone(204)).toBe('hit');
    expect(tone(225)).toBe('miss');
    expect(tone(195)).toBe('miss');
  });

  it('keeps a short rest to its tone', () => {
    const short = createWorkout({
      type: 'int',
      ints: [iv(210, 5), iv(210, 0)],
    });
    const out = named(drive(short, interval(0, 210)), 'rest');
    expect(out[0].voiced).toBe(false);
  });

  it('says nothing about the last interval closing: finish owns it', () => {
    const one = createWorkout({ type: 'int', ints: [iv(210, 0)] });
    const out = drive(one, interval(0, 210, END));
    expect(named(out, 'rest')).toHaveLength(0);
    expect(named(out, 'hit').concat(named(out, 'miss'))).toHaveLength(0);
  });
});

describe('cueTriggers: hit and miss while working (E5)', () => {
  const dist = createWorkout({
    type: 'dist',
    total: 5000,
    split: 1000,
    zone: 'UT2',
    cp: 200,
  });
  function splits(watts, n) {
    const pace = Math.round(wattsToPace500(watts) * 100);
    const secs = 2 * wattsToPace500(watts);
    // A sample past 8 s lets the target announce go first, as it does live.
    const steps = [
      s(0, 0, 0, WORK, { pace500: pace, watts }),
      s(9000, 20, 90, WORK, { pace500: pace, watts }),
    ];
    for (let k = 1; k <= n; k++) {
      steps.push(
        s(k * 30000, secs * k, 1000 * k, WORK, { pace500: pace, watts })
      );
    }
    return steps;
  }

  it('voices one hit in three, starting with the first', () => {
    const { target } = bandForInterval(dist, 1);
    // Twelve splits planned, so no last-split or half call lands on the fourth.
    const eight = createWorkout({ ...dist, total: 12000 });
    const out = drive(eight, splits(target, 4));
    const hits = named(out, 'hit');
    expect(hits.map((i) => i.voiced)).toEqual([true, false, false, true]);
    expect(hits[0]).toMatchObject({ priority: 3, tone: 'hit', line: 'hit' });
    expect(
      named(drive(eight, splits(target, 4), 'quiet'), 'hit').some(
        (i) => i.voiced
      )
    ).toBe(false);
  });

  it('voices misses, then tone only after two in a row', () => {
    const { target } = bandForInterval(dist, 1);
    const out = named(drive(dist, splits(target + 30, 4)), 'miss');
    expect(out.map((i) => i.voiced)).toEqual([true, true, false, false]);
    expect(out[0]).toMatchObject({ dir: 'over', tone: 'miss' });
  });

  it('announces a split number when there is no band', () => {
    const noBand = createWorkout({
      type: 'dist',
      total: 5000,
      split: 1000,
      zone: null,
      cp: 200,
    });
    const out = named(drive(noBand, splits(150, 2)), 'split');
    expect(out).toHaveLength(2);
    expect(out[0].lead).toEqual({ kind: 'split_n', value: 2 });
    expect(out[0].tone).toBe('split_change');
  });

  it('keeps 500 m splits to a tone unless chatty', () => {
    const noBand = createWorkout({
      type: 'dist',
      total: 5000,
      split: 500,
      zone: null,
      cp: 200,
    });
    const steps = [s(0, 0, 0, WORK)];
    for (let k = 1; k <= 2; k++)
      steps.push(s(k * 30000, 110 * k, 500 * k, WORK));
    expect(named(drive(noBand, steps), 'split').map((i) => i.voiced)).toEqual([
      false,
      false,
    ]);
    expect(
      named(drive(noBand, steps, 'chatty'), 'split').map((i) => i.voiced)
    ).toEqual([true, true]);
  });

  it('calls the last split of a fixed piece, once', () => {
    const noBand = createWorkout({
      type: 'dist',
      total: 3000,
      split: 1000,
      zone: null,
      cp: 200,
    });
    const out = named(drive(noBand, splits(150, 2)), 'last');
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe(1);
  });
});

describe('cueTriggers: zone (E4)', () => {
  // Interval 1 target 210 W, so the band is 205 to 215 W.
  const steps = (watts, from, to, step = 1000) => {
    const out = [];
    for (let t = from; t <= to; t += step) {
      out.push(s(t, t / 1000, t / 100, WORK, { watts }));
    }
    return out;
  };
  const longInt = createWorkout({
    type: 'int',
    ints: [iv(210, 60, { work: 3000 }), iv(210, 0, { work: 3000 })],
  });

  it('stays quiet through the first 10 s of the segment', () => {
    const out = drive(longInt, steps(180, 0, 9000));
    expect(out.filter((i) => i.event.startsWith('zone'))).toHaveLength(0);
  });

  it('flags a leave low after 6 s, then waits out the 30 s cooldown', () => {
    const out = drive(longInt, steps(190, 0, 60000)).filter(
      (i) => i.event === 'zone_low'
    );
    expect(out.map((i) => i.t)).toEqual([16000, 46000]);
    expect(out[0]).toMatchObject({
      priority: 3,
      tone: 'zone_leave_low',
      dir: 'under',
    });
    expect(out[0].lead).toEqual({ kind: 'delta', value: 15 });
  });

  it('flags a leave high', () => {
    const out = drive(longInt, steps(230, 0, 20000)).filter(
      (i) => i.event === 'zone_high'
    );
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe('zone_leave_high');
  });

  it('welcomes you back into the band after 5 s, once per leave', () => {
    const out = drive(longInt, [
      ...steps(190, 0, 12000),
      ...steps(210, 13000, 40000),
    ]).filter((i) => i.event === 'zone_enter');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      line: 'in_band',
      tone: 'zone_enter',
      priority: 2,
    });
  });

  it('speaks at most two leaves per split, then tone only', () => {
    const alt = [];
    // Over, in, under, in, over: leave cues 30 s apart, three in one interval.
    alt.push(...steps(230, 0, 20000));
    alt.push(...steps(210, 21000, 26000));
    alt.push(...steps(190, 27000, 60000));
    alt.push(...steps(210, 61000, 66000));
    alt.push(...steps(230, 67000, 100000));
    const leaves = drive(longInt, alt, 'chatty').filter((i) =>
      /zone_(high|low)/.test(i.event)
    );
    expect(leaves.length).toBeGreaterThanOrEqual(3);
    expect(leaves.map((i) => i.voiced).slice(0, 3)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('freezes while the PM5 reports a rowing pause', () => {
    const paused = steps(190, 0, 40000).map((x) => ({ ...x, rowingState: 0 }));
    expect(
      drive(longInt, paused).filter((i) => i.event.startsWith('zone'))
    ).toHaveLength(0);
  });
});

describe('cueTriggers: half, last 500 m, last minute (E6 to E8)', () => {
  const long = createWorkout({
    type: 'int',
    ints: [iv(210, 60, { work: 4000 }), iv(210, 0, { work: 4000 })],
  });
  const run = (workout, pairs) =>
    drive(workout, [
      s(0, 0, 0, WORK),
      ...pairs.map(([t, e, m]) => s(t, e, m, WORK)),
    ]);

  it('fires each once as the segment passes its marks', () => {
    const out = run(long, [
      [10000, 100, 1000],
      [20000, 480, 2000],
      [21000, 490, 2050],
      [30000, 880, 3500],
      [31000, 890, 3600],
    ]);
    expect(named(out, 'half')).toHaveLength(1);
    expect(named(out, 'last500')).toHaveLength(1);
    expect(named(out, 'last500')[0].priority).toBe(1);
  });

  it('skips the half on a short segment', () => {
    const out = run(twoByK, [[10000, 130, 600]]);
    expect(named(out, 'half')).toHaveLength(0);
  });

  it('fires the last minute for a timed piece', () => {
    const timed = createWorkout({
      type: 'time',
      total: 600,
      split: 600,
      zone: null,
      cp: 200,
    });
    const out = drive(timed, [
      s(0, 0, 0, WORK),
      s(1000, 300, 1000, WORK),
      s(2000, 541, 1800, WORK),
      s(3000, 560, 1900, WORK),
    ]);
    expect(named(out, 'half')).toHaveLength(1);
    expect(named(out, 'lastmin')).toHaveLength(1);
  });

  it('goes quiet when the rowed piece runs past the plan', () => {
    const out = run(long, [
      [10000, 960, 4100],
      [11000, 970, 4200],
      [12000, 980, 3500],
    ]);
    expect(named(out, 'last500')).toHaveLength(0);
  });
});

describe('cueTriggers: rate (E11)', () => {
  const steps = (spm) => {
    const out = [];
    for (let t = 0; t <= 100000; t += 1000) {
      out.push(s(t, t / 1000, t / 100, WORK, { strokeRate: spm }));
    }
    return out;
  };
  const long = createWorkout({
    type: 'int',
    ints: [iv(210, 60, { work: 5000 })],
  });

  it('speaks after 15 s of 3 spm off, at most 60 s apart', () => {
    const out = named(drive(long, steps(30)), 'rate');
    expect(out.map((i) => i.t)).toEqual([25000, 85000]);
    expect(out[0].lead).toEqual({ kind: 'rate_n', value: 30 });
  });

  it('stays quiet in range, and when quiet chattiness is set', () => {
    expect(named(drive(long, steps(25)), 'rate')).toHaveLength(0);
    expect(named(drive(long, steps(30), 'quiet'), 'rate')).toHaveLength(0);
  });
});

describe('cueTriggers: limits', () => {
  it('does not voice two P2/P3 cues inside the spacing, and never gates P0', () => {
    const steps = [];
    // Alternate over and under every 7 s so leave cues keep qualifying.
    for (let t = 0; t <= 120000; t += 1000) {
      const watts = Math.floor(t / 31000) % 2 === 0 ? 190 : 230;
      steps.push(s(t, t / 1000, t / 100, WORK, { watts }));
    }
    const long = createWorkout({
      type: 'int',
      ints: [iv(210, 0, { work: 5000 })],
    });
    const voiced = drive(long, steps, 'chatty').filter(
      (i) => i.voiced && i.priority >= 2
    );
    for (let i = 1; i < voiced.length; i++) {
      expect(voiced[i].t - voiced[i - 1].t).toBeGreaterThanOrEqual(
        VOICE_SPACING_MS
      );
    }
  });

  it('gives the same intents for the same samples', () => {
    const steps = [...interval(0, 210), ...interval(130000, 190)];
    expect(drive(twoByK, steps)).toEqual(drive(twoByK, steps));
  });

  it('has the standard level as the default', () => {
    expect(CHATTINESS.standard).toMatchObject({
      hitEvery: 3,
      splits500: false,
      budget: 6,
    });
  });
});
