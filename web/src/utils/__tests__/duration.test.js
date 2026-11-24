import { describe, it, expect } from 'vitest';
import {
  parseDurationMinutes,
  durationDisplay,
  resolveSessionMinutes,
} from '../duration.js';

describe('parseDurationMinutes', () => {
  it('parses mm:ss "45:00" as 45', () => {
    expect(parseDurationMinutes('45:00')).toBe(45);
  });
  it('parses mm:ss "60:00" as 60', () => {
    expect(parseDurationMinutes('60:00')).toBe(60);
  });
  it('parses mm:ss "35:00" as 35', () => {
    expect(parseDurationMinutes('35:00')).toBe(35);
  });
  it('parses minutes suffix "57m" as 57', () => {
    expect(parseDurationMinutes('57m')).toBe(57);
  });
  it('parses minutes suffix "9min" as 9', () => {
    expect(parseDurationMinutes('9min')).toBe(9);
  });
  it('parses minutes suffix "60min" as 60', () => {
    expect(parseDurationMinutes('60min')).toBe(60);
  });
  it('parses hours+minutes "1h4m" as 64', () => {
    expect(parseDurationMinutes('1h4m')).toBe(64);
  });
  it('parses hours+minutes "2h00m" as 120', () => {
    expect(parseDurationMinutes('2h00m')).toBe(120);
  });
  it('parses bare numeric string "45" as 45', () => {
    expect(parseDurationMinutes('45')).toBe(45);
  });
  it('passes a JS number 45 through unchanged', () => {
    expect(parseDurationMinutes(45)).toBe(45);
  });
  it('returns 0 for null', () => {
    expect(parseDurationMinutes(null)).toBe(0);
  });
  it('returns 0 for undefined', () => {
    expect(parseDurationMinutes(undefined)).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(parseDurationMinutes('')).toBe(0);
  });
  it('returns 0 for garbage', () => {
    expect(parseDurationMinutes('garbage')).toBe(0);
  });
  it('returns 0 for NaN', () => {
    expect(parseDurationMinutes(NaN)).toBe(0);
  });

  it('parses hh:mm:ss "1:02:03" as 62 + 3/60', () => {
    expect(parseDurationMinutes('1:02:03')).toBe(62 + 3 / 60);
  });
  it('parses hh:mm:ss "12:00:00" as 720', () => {
    expect(parseDurationMinutes('12:00:00')).toBe(720);
  });
  it('keeps two-part "120:00" as mm:ss = 120, not 2 hours', () => {
    expect(parseDurationMinutes('120:00')).toBe(120);
  });
  it('returns 0 for leftover shapes that stay unparseable', () => {
    // Invented examples of the leftover categories; not live values.
    expect(parseDurationMinutes('~15m')).toBe(0);
    expect(parseDurationMinutes('20-30min')).toBe(0);
  });

  it('never throws and never produces NaN for malformed input', () => {
    const malformed = [null, undefined, '', 'garbage', NaN, {}, [], 'h', ':'];
    malformed.forEach((v) => {
      let out;
      expect(() => {
        out = parseDurationMinutes(v);
      }).not.toThrow();
      expect(Number.isNaN(out)).toBe(false);
    });
  });
});

// AC-T4: what the session lists show, separate from what load maths reads.
describe('durationDisplay', () => {
  it.each([
    ['53m', { kind: 'minutes', minutes: 53 }],
    ['9min', { kind: 'minutes', minutes: 9 }],
    ['1h4m', { kind: 'minutes', minutes: 64 }],
    ['2h00m', { kind: 'minutes', minutes: 120 }],
    ['1h', { kind: 'minutes', minutes: 60 }],
    ['57', { kind: 'minutes', minutes: 57 }],
    [' 57 ', { kind: 'minutes', minutes: 57 }],
    ['57.5m', { kind: 'minutes', minutes: 57.5 }],
    ['60MIN', { kind: 'minutes', minutes: 60 }],
    [45, { kind: 'minutes', minutes: 45 }],
    ['26:00', { kind: 'clock', text: '26:00' }],
    ['1:02:03', { kind: 'clock', text: '1:02:03' }],
    ['abc', { kind: 'raw', text: 'abc' }],
    ['about an hour', { kind: 'raw', text: 'about an hour' }],
  ])('%j → %j', (input, expected) => {
    expect(durationDisplay(input)).toEqual(expected);
  });

  it.each([null, undefined, '', '   ', NaN])('%j renders nothing', (input) => {
    expect(durationDisplay(input)).toBeNull();
  });
});

describe('resolveSessionMinutes', () => {
  it('prefers duration_min when the key is present, including null', () => {
    expect(resolveSessionMinutes({ duration: '60:00', duration_min: 53 })).toBe(
      53
    );
    expect(
      resolveSessionMinutes({ duration: '60:00', duration_min: null })
    ).toBeNull();
    expect(
      resolveSessionMinutes({ duration: 'garbage', duration_min: 64 })
    ).toBe(64);
  });

  it('falls back to parseDurationMinutes only when the key is absent', () => {
    expect(resolveSessionMinutes({ duration: '1h4m' })).toBe(64);
    expect(resolveSessionMinutes({ duration: '1:02:03' })).toBe(62 + 3 / 60);
    expect(resolveSessionMinutes({ duration: 'garbage' })).toBeNull();
    expect(resolveSessionMinutes({ duration: null })).toBeNull();
    expect(resolveSessionMinutes(undefined)).toBeNull();
  });
});
