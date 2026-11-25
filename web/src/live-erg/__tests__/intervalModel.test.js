import { describe, expect, it } from 'vitest';
import { classifyZone } from '../../utils/pace.js';
import {
  BAND_W,
  MAX_INTERVALS,
  MAX_REST_S,
  MIN_DIST_M,
  MIN_SPLIT_S,
  PLACEHOLDER_CP_W,
  TERMS,
  addInterval,
  bandForInterval,
  csafePreview,
  classifyBand,
  createWorkout,
  currentInterval,
  currentSplitFrom,
  formatDeltaW,
  formatDuration,
  formatMetres,
  intervalBand,
  intervalsOf,
  midZoneWatts,
  moveInterval,
  pace500ToWatts,
  planCount,
  planLength,
  removeInterval,
  resolvedCp,
  setIntervalUnit,
  shapeSplitTable,
  stepIntervalField,
  term,
  totalsFrom,
  validateWorkout,
  wattsToPace500,
  workoutTitle,
  zoneTimeFromSamples,
} from '../intervalModel.js';

const fourHorsemen = () =>
  createWorkout({
    type: 'int',
    name: 'The Four Horsemen',
    ints: [
      { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
      { work: 1000, unit: 'm', rest: 120, watts: 200, rate: 22 },
      { work: 1000, unit: 'm', rest: 120, watts: 200, rate: 22 },
      { work: 1000, unit: 'm', rest: 0, watts: 210, rate: 24 },
    ],
  });

describe('terminology', () => {
  it('uses erg words by default and never calls a work block a rep', () => {
    expect(term('interval')).toBe('Interval');
    expect(term('spm')).toBe('spm');
    expect(term('interval', 'plain')).toBe('Interval');
    expect(term('piece', 'plain')).toBe('Workout');
    expect(JSON.stringify(TERMS)).not.toMatch(/paddle/i);
    expect(term('easy')).toBe('Easy row');
  });
});

describe('watts and pace', () => {
  it('uses Concept2 2.80 / (s/m)^3 both ways', () => {
    const pace = wattsToPace500(200);
    expect(pace500ToWatts(pace)).toBeCloseTo(200, 8);
    expect(pace500ToWatts(500 * (2.8 / 200) ** (1 / 3))).toBeCloseTo(200, 8);
  });
});

describe('critical power and zones', () => {
  it('takes mid-zone watts from derivePaceZones, not a local table', () => {
    const mid = midZoneWatts(200, 'UT2');
    expect(mid).toBe(
      Math.round((Math.round(200 * 0.55) + Math.round(200 * 0.7)) / 2)
    );
    expect(classifyZone(mid, 200)).toBe('UT2');
  });

  it('does not invent a CP when none is provided', () => {
    expect(resolvedCp(null)).toEqual({
      cp: PLACEHOLDER_CP_W,
      placeholder: true,
    });
    expect(resolvedCp(240)).toEqual({ cp: 240, placeholder: false });
    expect(midZoneWatts(null)).toBeNull();
  });

  it('feeds timeInZones from samples', () => {
    const mid = midZoneWatts(200, 'UT2');
    const result = zoneTimeFromSamples(
      Array.from({ length: 10 }, () => ({ watts: mid, dt: 1 })),
      200
    );
    const ut2 = result.bands.find((b) => b.zone === 'UT2');
    expect(ut2.seconds).toBe(10);
    expect(result.zonedS).toBe(10);
  });
});

describe('variable intervals', () => {
  it('keeps a set target on each interval and looks up the current one', () => {
    const w = fourHorsemen();
    expect(intervalsOf(w)).toHaveLength(4);
    expect(currentInterval(w, 1).watts).toBe(210);
    expect(currentInterval(w, 1).rate).toBe(24);
    expect(currentInterval(w, 2).watts).toBe(200);
    expect(currentInterval(w, 2).rate).toBe(22);
    expect(currentInterval(w, 9).watts).toBe(210);
  });

  it('adds, removes and reorders without mutating the original', () => {
    const w = fourHorsemen();
    const added = addInterval(w);
    expect(added.ints).toHaveLength(5);
    expect(w.ints).toHaveLength(4);
    expect(added.ints[3].rest).toBe(120);
    expect(added.ints[4].rest).toBe(0);
    expect(added.ints[4].watts).toBe(210);

    const moved = moveInterval(w, 0, 1);
    expect(moved.ints[0].watts).toBe(200);
    expect(moved.ints[1].watts).toBe(210);
    expect(w.ints[0].watts).toBe(210);

    const removed = removeInterval(w, 1);
    expect(removed.ints).toHaveLength(3);
    expect(removed.ints[1].watts).toBe(200);
    expect(
      removeInterval(createWorkout({ type: 'int', ints: [w.ints[0]] }), 0).ints
    ).toHaveLength(1);
  });

  it('caps the list at 50 and switches unit to the v10 defaults', () => {
    let w = createWorkout({
      type: 'int',
      ints: [{ work: 1000, unit: 'm', rest: 0, watts: 200, rate: 22 }],
    });
    for (let i = 0; i < 60; i += 1) w = addInterval(w);
    expect(w.ints).toHaveLength(MAX_INTERVALS);
    const timed = setIntervalUnit(w, 0, 's');
    expect(timed.ints[0]).toMatchObject({ unit: 's', work: 480 });
    const dist = setIntervalUnit(timed, 0, 'm');
    expect(dist.ints[0]).toMatchObject({ unit: 'm', work: 1000 });
  });

  it('clamps stepper fields to the PM5 limits', () => {
    const w = createWorkout({
      type: 'int',
      ints: [{ work: 1000, unit: 'm', rest: 120, watts: 200, rate: 22 }],
    });
    expect(stepIntervalField(w, 0, 'work', -250 * 20).ints[0].work).toBe(
      MIN_DIST_M
    );
    expect(stepIntervalField(w, 0, 'rest', 15 * 100).ints[0].rest).toBe(
      MAX_REST_S
    );
    expect(stepIntervalField(w, 0, 'rate', -1).ints[0].rate).toBe(21);
    const timed = setIntervalUnit(w, 0, 's');
    expect(stepIntervalField(timed, 0, 'work', -30 * 100).ints[0].work).toBe(
      MIN_SPLIT_S
    );
  });
});

describe('validateWorkout', () => {
  it('enforces CSAFE split, distance, count and rest limits', () => {
    expect(
      validateWorkout({ type: 'time', total: 1800, split: 15 })[0]
    ).toMatch(/0:20/);
    expect(
      validateWorkout({ type: 'time', total: 1800, split: 5401 })[0]
    ).toMatch(/1:30:00/);
    expect(
      validateWorkout({ type: 'time', total: 300, split: 600 })[0]
    ).toMatch(/longer than the piece/);
    expect(
      validateWorkout({ type: 'time', total: 1800, split: 20 })[0]
    ).toMatch(/50 at most/);
    expect(
      validateWorkout({ type: 'dist', total: 2000, split: 50 })[0]
    ).toMatch(/100 m/);
    expect(
      validateWorkout({
        type: 'int',
        ints: [{ work: 10, unit: 's', rest: 0, watts: 200, rate: 22 }],
      })[0]
    ).toMatch(/0:20 to 59:59/);
    expect(
      validateWorkout({
        type: 'int',
        ints: [{ work: 50, unit: 'm', rest: 600, watts: 200, rate: 22 }],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/100 m/),
        expect.stringMatching(/9:55/),
      ])
    );
    expect(validateWorkout(fourHorsemen())).toEqual([]);
  });
});

describe('band classification', () => {
  it('judges against the interval’s set target, with a word and arrow, not colour alone', () => {
    const w = fourHorsemen();
    const band = bandForInterval(w, 1);
    expect(band).toEqual({ lo: 205, hi: 215, target: 210, rate: 24 });
    expect(intervalBand(currentInterval(w, 2)).target).toBe(200);

    const under = classifyBand(191, band);
    expect(under).toMatchObject({
      dir: 'under',
      x: 14,
      arrow: '▼',
      word: 'under',
      label: '▼ 14 W under 210 W',
    });

    const over = classifyBand(229, band);
    expect(over).toMatchObject({
      dir: 'over',
      x: 14,
      arrow: '▲',
      word: 'over',
      label: '▲ 14 W over 210 W',
    });

    const inside = classifyBand(210, band);
    expect(inside).toMatchObject({ dir: 'in', x: 0, word: 'In band' });
    expect(inside.label).toBe('In band · 210 W');

    // Still in band at the ±5 edge plus the 2 W latch.
    expect(classifyBand(203, band).dir).toBe('in');
    expect(classifyBand(217, band).dir).toBe('in');
    expect(classifyBand(202, band).dir).toBe('under');
    expect(BAND_W).toBe(5);
  });
});

describe('titles and CSAFE preview', () => {
  it('names a mixed-target list as variable intervals', () => {
    expect(workoutTitle(fourHorsemen())).toBe('4 × 1,000 m · 2:00 rest');
    const mixed = createWorkout({
      type: 'int',
      ints: [
        { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
        { work: 480, unit: 's', rest: 0, watts: 155, rate: 22 },
      ],
    });
    expect(workoutTitle(mixed)).toBe('2 variable intervals');
    const even = createWorkout({
      type: 'int',
      ints: [
        { work: 1000, unit: 'm', rest: 120, watts: 200, rate: 22 },
        { work: 1000, unit: 'm', rest: 0, watts: 200, rate: 22 },
      ],
    });
    expect(workoutTitle(even)).toBe('2 × 1,000 m · 2:00 rest');
    expect(formatMetres(1000)).toBe('1,000');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('lists each interval’s length, rest and watts, and keeps rate off the PM5', () => {
    const lines = csafePreview(fourHorsemen());
    expect(lines[0].value).toMatch(/variable intervals \(4\)/i);
    expect(lines[1].value).toBe('1,000 m · rest 2:00 · 210 W');
    expect(lines.some((l) => /spm|rate/i.test(l.value))).toBe(false);
  });
});

describe('split table shaping', () => {
  const splits = [
    { n: 1, time: 120, m: 500, pace: 120, w: 200, spm: 22, hr: 150, rest: 60 },
    { n: 2, time: 122, m: 500, pace: 122, w: 190, spm: 21, hr: 155, rest: 60 },
  ];

  it('puts planned distance in the metres column, not the time column', () => {
    const workout = createWorkout({ type: 'dist', total: 2000, split: 500 });
    const table = shapeSplitTable({
      workout,
      splits,
      current: currentSplitFrom({
        splits,
        splitTime: 30,
        metres: 100,
        pace: 150,
        watts: 180,
        spm: 20,
        hr: 140,
      }),
      phase: 'work',
    });
    const plan = table.rows.filter((r) => r.kind === 'plan');
    expect(plan).toHaveLength(1);
    expect(plan[0].cells.Metres).toBe('500');
    expect(plan[0].cells.Time).toBe('·');
    const now = table.rows.find((r) => r.kind === 'now');
    expect(now.cells['#']).toBe('▸3');
  });

  it('puts planned time in the time column for timed intervals', () => {
    const workout = createWorkout({
      type: 'int',
      ints: [
        { work: 480, unit: 's', rest: 120, watts: 155, rate: 22 },
        { work: 480, unit: 's', rest: 0, watts: 155, rate: 22 },
      ],
    });
    const table = shapeSplitTable({ workout, splits: [], phase: 'ready' });
    expect(table.rows[0]).toMatchObject({
      kind: 'plan',
      cells: { Time: '8:00', Metres: '·' },
    });
    expect(planLength(workout, 0).text).toBe('8:00');
    expect(planCount(workout)).toBe(2);
  });

  it('builds a sum row, ΔW from the previous split, and rest on a summary', () => {
    const workout = fourHorsemen();
    const table = shapeSplitTable({
      workout,
      splits,
      phase: 'rest',
      summary: true,
    });
    const sum = table.rows.find((r) => r.kind === 'sum');
    expect(sum.cells['#']).toBe('All');
    expect(sum.cells['ΔW']).toBe('');
    expect(sum.rest).toBe('2:00');
    const second = table.rows.find(
      (r) => r.kind === 'split' && r.cells['#'] === 2
    );
    expect(second.cells['ΔW']).toBe(formatDeltaW(-10));
    expect(table.rows.some((r) => r.kind === 'plan')).toBe(false);
    const tot = totalsFrom(splits);
    expect(tot.m).toBe(1000);
    expect(tot.rest).toBe(120);
  });
});
