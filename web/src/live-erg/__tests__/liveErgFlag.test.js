import { describe, expect, it } from 'vitest';
import {
  LIVE_ERG_FLAG_KEY,
  readLiveErgFlag,
  readSavedWorkout,
  saveWorkout,
  writeLiveErgFlag,
} from '../liveErgFlag.js';

function memory() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe('liveErgFlag', () => {
  it('is off by default and when storage is missing or throws', () => {
    expect(readLiveErgFlag(memory())).toBe(false);
    expect(readLiveErgFlag(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLiveErgFlag(broken)).toBe(false);
  });

  it('turns on and off', () => {
    const store = memory();
    expect(writeLiveErgFlag(true, store)).toBe(true);
    expect(store.getItem(LIVE_ERG_FLAG_KEY)).toBe('v10');
    expect(readLiveErgFlag(store)).toBe(true);
    writeLiveErgFlag(false, store);
    expect(readLiveErgFlag(store)).toBe(false);
  });

  it('round-trips the saved workout and ignores junk', () => {
    const store = memory();
    expect(readSavedWorkout(store)).toBeNull();
    saveWorkout({ type: 'int', ints: [{ work: 500 }] }, store);
    expect(readSavedWorkout(store).ints[0].work).toBe(500);
    store.setItem('splitiq.liveErg.workout', '{not json');
    expect(readSavedWorkout(store)).toBeNull();
  });
});
