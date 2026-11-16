import { describe, it, expect } from 'vitest';
import { C, ICON } from '../ui.js';
import { THEME } from '../theme.js';
import { DARK } from '../themeValues.js';

// C used to carry raw hex literals (#279), so a light flip would have left the
// session-type accents behind on the dark palette. It now points at THEME. This
// locks both halves: that the indirection resolves to the values it replaced,
// and that each type keeps the accent its meaning is assigned in conventions.md.
const EXPECTED = {
  'Z2 Aerobic': ['#5cc8e8', 'accent'],
  Threshold: ['#f0c75e', 'caution'],
  'VO₂ Intervals': ['#ff9b6a', 'warning'],
  Sharpener: ['#ff6f86', 'critical'],
  Rest: ['#4a4e5a', 'neutral'],
  'Upper Strength': ['#c4b5fd', 'accentAlt'],
  'Lower Strength': ['#6fd69a', 'positive'],
  Combined: ['#f0a3c8', 'accentAlt2'],
  Cycling: ['#5eead4', 'cycling'],
};

describe('C — session type accents', () => {
  it('covers exactly the nine design-system session types', () => {
    expect(Object.keys(C).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('resolves to the values the raw literals carried', () => {
    for (const [, [hex, token]] of Object.entries(EXPECTED)) {
      expect(DARK[token]).toBe(hex);
    }
  });

  it('reads every accent through THEME, never a literal', () => {
    for (const [type, [, token]] of Object.entries(EXPECTED)) {
      expect(C[type]).toBe(THEME[token]);
    }
  });
});

describe('ICON', () => {
  it('has an icon for every type C colours', () => {
    expect(Object.keys(ICON).sort()).toEqual(Object.keys(C).sort());
  });
});
