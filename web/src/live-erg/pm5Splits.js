import {
  isEndState,
  isRestState,
  isWorkingState,
} from '../services/pm5Bluetooth.js';
import { currentInterval, currentSplitFrom } from './intervalModel.js';

// Turns usePM5's live samples (one per 0031 packet: elapsedTime s, distance
// m, workoutState, strokeRate, pace500 in 0.01 s, watts) into the split rows
// the v10 table shows. Pure: one sample in, a new state out.
//
// Interval workouts close a split when the PM5 goes from work to rest (or
// ends the piece). Fixed time and distance pieces close one every planned
// split. The PM5 may restart its clocks for each interval, so a work sample
// whose clock is behind the last one starts from zero.

export function createSplitTracker() {
  return {
    phase: 'ready',
    splits: [],
    intervalNo: 1,
    base: { t: 0, d: 0 },
    last: null,
    spmSum: 0,
    spmTime: 0,
    sample: null,
  };
}

function splitRow(state, sample, workout) {
  const time = sample.elapsedTime - state.base.t;
  const m = sample.distance - state.base.d;
  const spm = state.spmTime > 0 ? state.spmSum / state.spmTime : null;
  const row = currentSplitFrom({
    n: state.splits.length + 1,
    splitTime: time,
    metres: m,
    pace: sample.pace500 > 0 ? sample.pace500 / 100 : null,
    watts: sample.watts,
    spm: spm ?? sample.strokeRate,
    hr: null,
  });
  if (workout && workout.type === 'int') {
    const iv = currentInterval(workout, state.intervalNo);
    row.rest = iv ? iv.rest : null;
  }
  return row;
}

function closeSplit(state, sample, workout) {
  const row = splitRow(state, sample, workout);
  if (!(row.time >= 1)) return state.splits;
  return state.splits.concat([row]);
}

function crossedPlannedSplit(state, sample, workout) {
  if (!workout || !(workout.split > 0)) return false;
  if (workout.type === 'dist') {
    return sample.distance - state.base.d >= workout.split;
  }
  if (workout.type === 'time') {
    return sample.elapsedTime - state.base.t >= workout.split;
  }
  return false;
}

export function trackSample(state, sample, workout) {
  if (!sample || !Number.isFinite(sample.elapsedTime)) return state;
  const ws = sample.workoutState;
  const next = { ...state, sample };

  if (isWorkingState(ws)) {
    if (state.phase !== 'work') {
      const resumed =
        state.phase === 'rest' &&
        state.last &&
        sample.elapsedTime >= state.last.elapsedTime;
      next.base = resumed
        ? { t: state.last.elapsedTime, d: state.last.distance }
        : { t: 0, d: 0 };
      next.phase = 'work';
      next.spmSum = 0;
      next.spmTime = 0;
    } else if (crossedPlannedSplit(state, sample, workout)) {
      next.splits = closeSplit(state, sample, workout);
      next.base = { t: sample.elapsedTime, d: sample.distance };
      next.spmSum = 0;
      next.spmTime = 0;
    } else if (state.last && sample.strokeRate != null) {
      const dt = sample.elapsedTime - state.last.elapsedTime;
      if (dt > 0 && dt < 5) {
        next.spmSum = state.spmSum + sample.strokeRate * dt;
        next.spmTime = state.spmTime + dt;
      }
    }
    next.last = sample;
    return next;
  }

  if (state.phase === 'work' && (isRestState(ws) || isEndState(ws))) {
    const from = state.last || sample;
    next.splits = closeSplit(state, from, workout);
    next.phase = isEndState(ws) ? 'done' : 'rest';
    next.intervalNo = state.intervalNo + 1;
    return next;
  }
  if (isEndState(ws)) next.phase = 'done';
  return next;
}

// The split in progress, for the table's ▸ row. Null outside work.
export function currentSplitOf(state, workout) {
  if (state.phase !== 'work' || !state.last) return null;
  return splitRow(state, state.last, workout);
}
