import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAST_PM5_ID_KEY,
  readLastPm5Id,
  writeLastPm5Id,
} from '../pm5LastUsed.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('pm5LastUsed', () => {
  it('returns null when nothing has been stored', () => {
    expect(readLastPm5Id()).toBeNull();
  });

  it('round-trips a device id', () => {
    writeLastPm5Id('pm5-abc');
    expect(window.localStorage.getItem(LAST_PM5_ID_KEY)).toBe('pm5-abc');
    expect(readLastPm5Id()).toBe('pm5-abc');
  });

  it('ignores an empty write', () => {
    writeLastPm5Id('pm5-abc');
    writeLastPm5Id('');
    expect(readLastPm5Id()).toBe('pm5-abc');
  });
});
