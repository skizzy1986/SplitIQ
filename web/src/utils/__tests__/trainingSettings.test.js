import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  WRITABLE_COLUMNS,
  localIsoDate,
  normalizeSettings,
  parseBirthYear,
  pathForChoice,
  writablePatch,
} from '../trainingSettings.js';

const NOW = new Date(2026, 10, 27, 9, 0, 0);

describe('trainingSettings', () => {
  it('maps the strap answer to a path; no strap, and a watch alone, is RPE', () => {
    expect(pathForChoice(true)).toBe('strap');
    expect(pathForChoice(false)).toBe('rpe');
  });

  it('reads an absent row as nothing chosen, simple depth and the caution flag off', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined).hr_caution).toBe(false);
    expect(normalizeSettings({}).depth).toBe('simple');
    expect(normalizeSettings({ hr_path: 'watch', depth: 'deep' })).toEqual(
      DEFAULT_SETTINGS
    );
  });

  it('keeps the stored values it recognises', () => {
    const row = {
      hr_path: 'strap',
      hr_path_chosen_on: '2026-11-27',
      birth_year: 1985,
      time_zone: 'Australia/Perth',
      depth: 'expert',
      hr_caution: true,
    };
    expect(normalizeSettings(row)).toMatchObject(row);
  });

  it('writes only columns the database lets a user write, and keeps null', () => {
    expect(WRITABLE_COLUMNS).not.toContain('user_id');
    expect(WRITABLE_COLUMNS).not.toContain('created_at');
    expect(WRITABLE_COLUMNS).not.toContain('calibrate_from_strava');
    expect(
      writablePatch({
        user_id: 'x',
        created_at: 'y',
        calibrate_from_strava: true,
        birth_year: null,
        hr_path: undefined,
        depth: 'expert',
      })
    ).toEqual({ birth_year: null, depth: 'expert' });
  });

  it('formats the local calendar date', () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('accepts a four-digit year of someone 18 or over', () => {
    expect(parseBirthYear('1985', NOW)).toEqual({ ok: true, year: 1985 });
    expect(parseBirthYear(' 2008 ', NOW)).toEqual({ ok: true, year: 2008 });
  });

  it('refuses anything else, with a code and never the value', () => {
    for (const raw of [
      '',
      'abc',
      '85',
      '19850',
      '1899',
      '2027',
      '19.5',
      null,
    ]) {
      expect(parseBirthYear(raw, NOW)).toEqual({ ok: false, code: 'invalid' });
    }
    expect(parseBirthYear('2009', NOW)).toEqual({
      ok: false,
      code: 'too_young',
    });
    expect(JSON.stringify(parseBirthYear('2020', NOW))).not.toContain('2020');
  });
});
