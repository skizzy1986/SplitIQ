import { describe, expect, it } from 'vitest';
import {
  CUES_CHATTER_KEY,
  CUES_ENABLED_KEY,
  CUES_VOICE_KEY,
  markCuesOnboarded,
  readCueChatter,
  readCueVoice,
  readCuesEnabled,
  readCuesOnboarded,
  writeCueVoice,
  writeCuesEnabled,
} from '../cueSettings.js';

function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('cueSettings', () => {
  it('defaults: off, Dry voice, standard chattiness, not onboarded', () => {
    const s = memory();
    expect(readCuesEnabled(s)).toBe(false);
    expect(readCueVoice(s)).toBe('dry');
    expect(readCueChatter(s)).toBe('standard');
    expect(readCuesOnboarded(s)).toBe(false);
  });

  it('survives missing or blocked storage', () => {
    for (const s of [null, broken]) {
      expect(readCuesEnabled(s)).toBe(false);
      expect(readCueVoice(s)).toBe('dry');
      expect(readCueChatter(s)).toBe('standard');
      expect(writeCuesEnabled(true, s)).toBe(false);
      expect(writeCueVoice('technical', s)).toBe(false);
      expect(markCuesOnboarded(s)).toBe(false);
    }
  });

  it('ignores values it does not know', () => {
    const s = memory({
      [CUES_ENABLED_KEY]: 'yes',
      [CUES_VOICE_KEY]: 'pirate',
      [CUES_CHATTER_KEY]: 'loud',
    });
    expect(readCuesEnabled(s)).toBe(false);
    expect(readCueVoice(s)).toBe('dry');
    expect(readCueChatter(s)).toBe('standard');
    expect(writeCueVoice('pirate', s)).toBe(false);
  });

  it('round-trips the switch, the voice and the onboarding mark', () => {
    const s = memory();
    expect(writeCuesEnabled(true, s)).toBe(true);
    expect(readCuesEnabled(s)).toBe(true);
    expect(writeCuesEnabled(false, s)).toBe(true);
    expect(readCuesEnabled(s)).toBe(false);
    writeCueVoice('encouraging', s);
    expect(readCueVoice(s)).toBe('encouraging');
    markCuesOnboarded(s);
    expect(readCuesOnboarded(s)).toBe(true);
  });
});
