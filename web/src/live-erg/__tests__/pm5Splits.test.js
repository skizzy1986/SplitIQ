import { describe, expect, it } from 'vitest';
import {
  createSplitTracker,
  currentSplitOf,
  trackSample,
} from '../pm5Splits.js';
import { createWorkout } from '../intervalModel.js';

const WORK = 5; // intervalWorkDistance
const REST = 3; // intervalRest
const ROW = 1; // workoutRow
const END = 10; // workoutEnd

function s(elapsedTime, distance, workoutState, extra = {}) {
  return {
    elapsedTime,
    distance,
    workoutState,
    rowingState: 1,
    strokeRate: 24,
    pace500: 12000,
    watts: 203,
    ...extra,
  };
}

function run(samples, workout) {
  return samples.reduce(
    (st, x) => trackSample(st, x, workout),
    createSplitTracker()
  );
}

const twoByK = createWorkout({
  type: 'int',
  ints: [
    { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
    { work: 1000, unit: 'm', rest: 0, watts: 185, rate: 22 },
  ],
});

describe('pm5Splits', () => {
  it('stays ready until the PM5 reports work', () => {
    const st = run([s(0, 0, 0)], twoByK);
    expect(st.phase).toBe('ready');
    expect(currentSplitOf(st, twoByK)).toBeNull();
  });

  it('closes an interval split on rest and starts the next interval', () => {
    const st = run(
      [
        s(0, 0, WORK),
        s(100, 480, WORK),
        s(210, 1000, WORK),
        s(211, 1000, REST),
      ],
      twoByK
    );
    expect(st.phase).toBe('rest');
    expect(st.intervalNo).toBe(2);
    expect(st.splits).toHaveLength(1);
    const [row] = st.splits;
    expect(row.n).toBe(1);
    expect(row.time).toBe(210);
    expect(row.m).toBe(1000);
    expect(row.pace).toBeCloseTo(105, 5);
    expect(row.rest).toBe(120);
    expect(row.hr).toBeNull();
  });

  it('restarts from zero when the PM5 resets its clock for the next interval', () => {
    const st = run(
      [
        s(0, 0, WORK),
        s(210, 1000, WORK),
        s(211, 1000, REST),
        s(0, 0, WORK),
        s(100, 450, WORK),
      ],
      twoByK
    );
    expect(st.phase).toBe('work');
    const now = currentSplitOf(st, twoByK);
    expect(now.n).toBe(2);
    expect(now.time).toBe(100);
    expect(now.m).toBe(450);
  });

  it('carries on from the last clock when the PM5 keeps counting', () => {
    const st = run(
      [
        s(0, 0, WORK),
        s(210, 1000, WORK),
        s(211, 1000, REST),
        s(340, 1000, WORK),
        s(440, 1450, WORK),
      ],
      twoByK
    );
    const now = currentSplitOf(st, twoByK);
    expect(now.time).toBe(230);
    expect(now.m).toBe(450);
  });

  it('closes the last split when the piece ends', () => {
    const st = run([s(0, 0, ROW), s(200, 900, ROW), s(201, 900, END)], twoByK);
    expect(st.phase).toBe('done');
    expect(st.splits).toHaveLength(1);
  });

  it('splits a fixed distance piece every planned split', () => {
    const dist = createWorkout({ type: 'dist', total: 2000, split: 500 });
    const st = run(
      [s(0, 0, ROW), s(60, 300, ROW), s(105, 500, ROW), s(150, 700, ROW)],
      dist
    );
    expect(st.splits).toHaveLength(1);
    expect(st.splits[0].m).toBe(500);
    expect(currentSplitOf(st, dist).m).toBe(200);
  });

  it('averages stroke rate over the split', () => {
    const st = run(
      [
        s(0, 0, WORK, { strokeRate: 20 }),
        s(2, 8, WORK, { strokeRate: 20 }),
        s(4, 16, WORK, { strokeRate: 30 }),
      ],
      twoByK
    );
    expect(currentSplitOf(st, twoByK).spm).toBe(25);
  });

  it('ignores missing samples', () => {
    const st = createSplitTracker();
    expect(trackSample(st, null, twoByK)).toBe(st);
  });
});
