import { describe, it, expect } from 'vitest';
import { THEME } from '../theme.js';
import { DARK, LIGHT } from '../themeValues.js';

// The rower's scene tokens (#827), measured the way tokens.test.js in squat/
// measures the anatomy ones: WCAG relative luminance, per palette.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const KEYS = ['sceneSkin', 'sceneClothes', 'sceneClothesAlt', 'sceneErg'];
const PALETTES = [
  ['light', LIGHT],
  ['dark', DARK],
];

describe('rower scene tokens', () => {
  it.each(KEYS)('%s is a pointer with a hex on both palettes', (k) => {
    expect(THEME[k]).toMatch(/^var\(--color-scene-[a-z-]+\)$/);
    expect(LIGHT[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect(DARK[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(KEYS)('%s moves between light and dark', (k) => {
    expect(LIGHT[k]).not.toBe(DARK[k]);
  });

  it('keeps the four distinct inside each palette', () => {
    for (const [, p] of PALETTES) {
      expect(new Set(KEYS.map((k) => p[k])).size).toBe(KEYS.length);
    }
  });
});

describe.each(PALETTES)('rower scene contrast (%s)', (_name, p) => {
  // The mark is accent ink on the clothes-alt ground; the wordmark is positive
  // ink on it. The thinnest stroke of the mark is 6 of 192 units, so both are
  // held to the 4.5 of body text, not the 3 a graphic would need.
  it('keeps the mark readable on its ground', () => {
    expect(ratio(p.accent, p.sceneClothesAlt)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the wordmark readable on its ground', () => {
    expect(ratio(p.positive, p.sceneClothesAlt)).toBeGreaterThanOrEqual(4.5);
  });

  // The clothes and the erg are the big shapes against the stage, whose
  // gradient runs surface -> surfaceAlt (SquatStage). WCAG 1.4.11: 3:1.
  it.each(['sceneClothes', 'sceneErg'])('holds %s 3:1 on the stage', (k) => {
    expect(ratio(p[k], p.surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(p[k], p.surfaceAlt)).toBeGreaterThanOrEqual(3);
  });

  // Skin is a lit surface, shaded by the key light, not a UI object: it is
  // held to 2:1 on the stage, which is as pale a skin tone as the light stage
  // allows while still reading as skin and not as the stage.
  it('holds skin 2:1 on the stage', () => {
    expect(ratio(p.sceneSkin, p.surface)).toBeGreaterThanOrEqual(2);
    expect(ratio(p.sceneSkin, p.surfaceAlt)).toBeGreaterThanOrEqual(2);
  });

  // Neighbours on the body: the shirt on skin, the hands and feet on the erg,
  // the decal ground on the shirt.
  it.each([
    ['sceneSkin', 'sceneClothes'],
    ['sceneSkin', 'sceneErg'],
    ['sceneClothes', 'sceneErg'],
    ['sceneClothes', 'sceneClothesAlt'],
  ])('keeps %s and %s 1.5:1 apart', (a, b) => {
    expect(ratio(p[a], p[b])).toBeGreaterThanOrEqual(1.5);
  });
});
