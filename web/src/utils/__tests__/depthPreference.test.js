import { describe, it, expect } from 'vitest';
import {
  DEPTH_KEY,
  DEPTH_SIMPLE,
  DEPTH_EXPERT,
  DEPTHS,
  readDepthPref,
  writeDepthPref,
  initialDepth,
  storeDepth,
} from '../depthPreference.js';

function stubStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('storage blocked');
  },
  setItem: () => {
    throw new Error('storage blocked');
  },
};

describe('depthPreference keys', () => {
  // The app-wide key, not a screen-scoped one, so the next surface to read a
  // depth needs no migration.
  it('stores under splitiq.depth', () => {
    expect(DEPTH_KEY).toBe('splitiq.depth');
  });

  it('offers exactly the two depths', () => {
    expect(DEPTHS).toEqual([DEPTH_SIMPLE, DEPTH_EXPERT]);
    expect(DEPTH_SIMPLE).toBe('simple');
    expect(DEPTH_EXPERT).toBe('expert');
  });
});

describe('readDepthPref', () => {
  it('defaults to simple with nothing stored', () => {
    expect(readDepthPref(stubStorage())).toBe(DEPTH_SIMPLE);
  });

  it('reads a stored expert back', () => {
    expect(readDepthPref(stubStorage({ [DEPTH_KEY]: 'expert' }))).toBe(
      DEPTH_EXPERT
    );
  });

  it('falls back to simple for a value that is not a depth', () => {
    expect(readDepthPref(stubStorage({ [DEPTH_KEY]: 'neon' }))).toBe(
      DEPTH_SIMPLE
    );
  });

  it('returns simple when there is no storage at all', () => {
    expect(readDepthPref(null)).toBe(DEPTH_SIMPLE);
    expect(readDepthPref(undefined)).toBe(DEPTH_SIMPLE);
  });

  it('returns simple when storage throws', () => {
    expect(readDepthPref(throwingStorage)).toBe(DEPTH_SIMPLE);
  });
});

describe('writeDepthPref', () => {
  it('writes a known depth', () => {
    const storage = stubStorage();
    writeDepthPref(storage, DEPTH_EXPERT);
    expect(storage.map.get(DEPTH_KEY)).toBe('expert');
  });

  it('ignores a value that is not a depth', () => {
    const storage = stubStorage();
    writeDepthPref(storage, 'neon');
    expect(storage.map.has(DEPTH_KEY)).toBe(false);
  });

  it('does not throw when storage is blocked', () => {
    expect(() => writeDepthPref(throwingStorage, DEPTH_EXPERT)).not.toThrow();
    expect(() => writeDepthPref(null, DEPTH_EXPERT)).not.toThrow();
  });
});

describe('initialDepth', () => {
  it('reads the preference off a window', () => {
    const win = { localStorage: stubStorage({ [DEPTH_KEY]: 'expert' }) };
    expect(initialDepth(win)).toBe(DEPTH_EXPERT);
  });

  it('returns simple when the window cannot give up localStorage', () => {
    const win = {};
    Object.defineProperty(win, 'localStorage', {
      get() {
        throw new Error('storage disabled');
      },
    });
    expect(initialDepth(win)).toBe(DEPTH_SIMPLE);
  });
});

describe('storeDepth', () => {
  // Both window-level helpers resolve storage off the window themselves, so
  // this round trip exercises that lookup rather than just the stub.
  it('round-trips a depth through a window', () => {
    const win = { localStorage: stubStorage() };
    expect(initialDepth(win)).toBe(DEPTH_SIMPLE);
    storeDepth(win, DEPTH_EXPERT);
    expect(initialDepth(win)).toBe(DEPTH_EXPERT);
  });

  it('ignores a value that is not a depth', () => {
    const win = { localStorage: stubStorage() };
    storeDepth(win, 'neon');
    expect(win.localStorage.map.has(DEPTH_KEY)).toBe(false);
  });

  it('does not throw when the window cannot give up localStorage', () => {
    const win = {};
    Object.defineProperty(win, 'localStorage', {
      get() {
        throw new Error('storage disabled');
      },
    });
    expect(() => storeDepth(win, DEPTH_EXPERT)).not.toThrow();
  });
});
