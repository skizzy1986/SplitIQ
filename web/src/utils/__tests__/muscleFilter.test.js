import { describe, it, expect } from 'vitest';
import { muscleFilterTags } from '../muscleFilter.js';

// Copy of the Add exercise sheet's MUSCLES chips in StrengthLogger.jsx.
const MUSCLES = [
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'abdominals',
  'forearms',
];

describe('muscleFilterTags', () => {
  it('maps the Back chip to the catalogue back tags', () => {
    expect(muscleFilterTags('back')).toEqual(['middle back', 'lower back']);
  });

  it('passes lats through unchanged', () => {
    expect(muscleFilterTags('lats')).toEqual(['lats']);
  });

  it('maps every other chip to itself', () => {
    for (const chip of MUSCLES.filter((m) => m !== 'back')) {
      expect(muscleFilterTags(chip)).toEqual([chip]);
    }
  });
});
