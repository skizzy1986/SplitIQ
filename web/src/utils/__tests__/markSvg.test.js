import { describe, it, expect } from 'vitest';
import { markSvg, wordmarkSvg } from '../markSvg.js';
import {
  MARK_S_PATH,
  MARK_TILE_PATH,
  MARK_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from '../../constants/markPaths.js';
import { DARK, LIGHT } from '../../constants/themeValues.js';

const parse = (svg) => {
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc.documentElement;
};

describe('markSvg', () => {
  it('returns well-formed SVG on the icon grid, with no <text>', () => {
    const svg = markSvg({ ink: DARK.accent });
    const root = parse(svg);
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('viewBox')).toBe(MARK_VIEWBOX);
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font');
  });

  it('draws the square as a 6-unit stroke and the S as a fill, both in the ink', () => {
    const root = parse(markSvg({ ink: LIGHT.accent }));
    const [tile, s] = [...root.getElementsByTagName('path')];
    expect(tile.getAttribute('d')).toBe(MARK_TILE_PATH);
    expect(tile.getAttribute('fill')).toBe('none');
    expect(tile.getAttribute('stroke')).toBe(LIGHT.accent);
    expect(tile.getAttribute('stroke-width')).toBe('6');
    expect(s.getAttribute('d')).toBe(MARK_S_PATH);
    expect(s.getAttribute('fill')).toBe(LIGHT.accent);
  });

  it('paints the ground edge to edge when given one, and none otherwise', () => {
    const withGround = parse(
      markSvg({ ink: DARK.accent, ground: DARK.sceneClothesAlt })
    );
    const rect = withGround.getElementsByTagName('rect')[0];
    expect(rect.getAttribute('fill')).toBe(DARK.sceneClothesAlt);
    expect(rect.getAttribute('width')).toBe('192');
    expect(rect.getAttribute('height')).toBe('192');
    // The ground is the first thing drawn, so the stroke and S land on it.
    expect(withGround.firstElementChild).toBe(rect);

    expect(markSvg({ ink: DARK.accent })).not.toContain('<rect');
    expect(markSvg({ ink: DARK.accent, ground: null })).not.toContain('<rect');
  });

  it('takes its colours from the palette it is handed, so light and dark differ', () => {
    const colours = (p) => ({ ink: p.accent, ground: p.sceneClothesAlt });
    const dark = markSvg(colours(DARK));
    const light = markSvg(colours(LIGHT));
    expect(dark).not.toBe(light);
    expect(dark).toContain(DARK.accent);
    expect(dark).toContain(DARK.sceneClothesAlt);
    expect(dark).not.toContain(LIGHT.accent);
    expect(light).toContain(LIGHT.accent);
    expect(light).toContain(LIGHT.sceneClothesAlt);
  });

  it('is pure: the same input gives the same string', () => {
    const a = markSvg({ ink: '#5cc8e8', ground: '#0b0e16', size: 256 });
    expect(markSvg({ ink: '#5cc8e8', ground: '#0b0e16', size: 256 })).toBe(a);
  });

  it('sets a square pixel size, and leaves it off when none is given', () => {
    const root = parse(markSvg({ ink: DARK.accent, size: 96 }));
    expect(root.getAttribute('width')).toBe('96');
    expect(root.getAttribute('height')).toBe('96');
    const bare = parse(markSvg({ ink: DARK.accent }));
    expect(bare.hasAttribute('width')).toBe(false);
    expect(bare.hasAttribute('height')).toBe(false);
  });

  it('accepts a --color-* pointer, for the mark drawn inline in the DOM', () => {
    const svg = markSvg({ ink: 'var(--color-accent)' });
    expect(svg).toContain('stroke="var(--color-accent)"');
  });

  it.each([
    ['a named colour', 'red'],
    ['a function', 'rgb(0,0,0)'],
    ['an empty string', ''],
    ['a number', 0x5cc8e8],
    ['an attribute breakout', '#fff"/><script>alert(1)</script><path fill="'],
    ['a pointer with a breakout', 'var(--color-x)"/><g'],
    ['a short hex length', '#abcde'],
    ['undefined', undefined],
  ])('rejects %s as ink', (_label, bad) => {
    expect(() => markSvg({ ink: bad })).toThrow(TypeError);
  });

  it('rejects a bad ground, and a missing ink', () => {
    expect(() => markSvg({ ink: '#fff', ground: 'blue' })).toThrow(TypeError);
    expect(() => markSvg({ ground: '#fff' })).toThrow(TypeError);
    expect(() => markSvg()).toThrow(TypeError);
  });

  it.each([0, -1, NaN, Infinity, '96'])('rejects size %s', (size) => {
    expect(() => markSvg({ ink: '#fff', size })).toThrow(RangeError);
  });
});

describe('wordmarkSvg', () => {
  it('returns one filled path on the wordmark viewBox', () => {
    const svg = wordmarkSvg({ ink: DARK.positive });
    const root = parse(svg);
    expect(root.getAttribute('viewBox')).toBe(WORDMARK_VIEWBOX);
    const paths = root.getElementsByTagName('path');
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('d')).toBe(WORDMARK_PATH);
    expect(paths[0].getAttribute('fill')).toBe(DARK.positive);
    expect(svg).not.toContain('<text');
  });

  it('sizes by width and keeps the aspect', () => {
    const root = parse(wordmarkSvg({ ink: LIGHT.positive, size: 232.375 }));
    expect(root.getAttribute('width')).toBe('232.38');
    expect(Number(root.getAttribute('height'))).toBeCloseTo(41.43, 1);
  });

  it('validates its ink and size', () => {
    expect(() => wordmarkSvg({ ink: 'green' })).toThrow(TypeError);
    expect(() => wordmarkSvg({ ink: '#fff', size: 0 })).toThrow(RangeError);
  });
});
