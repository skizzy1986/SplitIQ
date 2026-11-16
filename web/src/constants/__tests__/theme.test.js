import { describe, it, expect } from 'vitest';
import { THEME } from '../theme.js';
import { DARK, LIGHT, DEFAULT_THEME } from '../themeValues.js';
import { cssVarName } from '../../utils/themeCss.js';

const EXPECTED_KEYS = [
  'bg',
  'surface',
  'raised',
  'field',
  'border',
  'text',
  'muted',
  'accent',
  'positive',
  'caution',
  'warning',
  'critical',
  'accentAlt',
  'accentAlt2',
  'cycling',
  'surfaceAlt',
  'surfaceDeep',
  'neutral',
  'textSubtle',
  'textFaint',
  'textDim',
  'divider',
  'neutralAccent',
  'textStrong',
  'modelled',
  'measured',
  'anatomyMuscle',
  'anatomyTendon',
  'anatomyBone',
  'anatomyShadow',
  'anatomyBar',
  'anatomyHeatLow',
  'anatomyHeatMid',
  'anatomyHeatHigh',
  'anatomyHeatPeak',
  'anatomyFocus',
];

// The activation ramp is geometry paint, not ink anyone reads, and starts on
// the source page's own four stops — so these four are the same on both
// palettes by design, and the "every value moves" rule exempts them.
const SHARED_BY_DESIGN = [
  'anatomyHeatLow',
  'anatomyHeatMid',
  'anatomyHeatHigh',
  'anatomyHeatPeak',
];

describe('THEME', () => {
  it('has exactly the 36 expected keys (no more, no fewer)', () => {
    const keys = Object.keys(THEME);
    expect(keys).toHaveLength(36);
    expect(keys.sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('is a pointer table — every value is a var(--color-*) reference', () => {
    for (const [key, value] of Object.entries(THEME)) {
      expect(value).toBe(`var(${cssVarName(key)})`);
    }
  });

  it('points at exactly the keys the palette defines', () => {
    expect(Object.keys(THEME).sort()).toEqual(Object.keys(DARK).sort());
  });
});

describe('DARK — the palette values THEME resolves to', () => {
  it('has exactly the 36 expected keys (no more, no fewer)', () => {
    const keys = Object.keys(DARK);
    expect(keys).toHaveLength(36);
    expect(keys.sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('every value is a 6-digit lowercase hex colour', () => {
    for (const value of Object.values(DARK)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('locks the canonical values', () => {
    expect(DARK.bg).toBe('#0d0e12');
    expect(DARK.surface).toBe('#16171d');
    expect(DARK.raised).toBe('#1e2027');
    expect(DARK.field).toBe('#1e2027');
    expect(DARK.border).toBe('#2a2d36');
    expect(DARK.text).toBe('#f3f4f6');
    expect(DARK.muted).toBe('#a9adba');
    expect(DARK.accent).toBe('#5cc8e8');
    expect(DARK.positive).toBe('#6fd69a');
    expect(DARK.caution).toBe('#f0c75e');
    expect(DARK.warning).toBe('#ff9b6a');
    expect(DARK.critical).toBe('#ff6f86');
    expect(DARK.accentAlt).toBe('#c4b5fd');
    expect(DARK.accentAlt2).toBe('#f0a3c8');
    expect(DARK.cycling).toBe('#5eead4');
    expect(DARK.surfaceAlt).toBe('#121318');
    expect(DARK.surfaceDeep).toBe('#090a0e');
    expect(DARK.neutral).toBe('#4a4e5a');
    expect(DARK.textSubtle).toBe('#a9adba');
    expect(DARK.textFaint).toBe('#8a8f9c');
    expect(DARK.textDim).toBe('#5c6170');
    expect(DARK.divider).toBe('#2a2d36');
    expect(DARK.neutralAccent).toBe('#8a8f9c');
    expect(DARK.textStrong).toBe('#ffffff');
    expect(DARK.modelled).toBe('#f2b45a');
    expect(DARK.measured).toBe('#86a8ff');
    expect(DARK.anatomyMuscle).toBe('#a52529');
    expect(DARK.anatomyTendon).toBe('#d5dbe0');
    expect(DARK.anatomyBone).toBe('#e6dccb');
    expect(DARK.anatomyShadow).toBe('#000004');
    expect(DARK.anatomyBar).toBe('#9aa3b5');
  });
});

describe('LIGHT — the second palette', () => {
  it('defines exactly the same keys as DARK', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
  });

  it('every value is a 6-digit lowercase hex colour', () => {
    for (const value of Object.values(LIGHT)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('moves every value — no token is shared with the dark palette', () => {
    const shared = Object.keys(DARK).filter(
      (k) => DARK[k] === LIGHT[k] && !SHARED_BY_DESIGN.includes(k)
    );
    expect(shared).toEqual([]);
    for (const k of SHARED_BY_DESIGN) expect(LIGHT[k]).toBe(DARK[k]);
  });

  it('paints the ground conventions.md settled on, not the withdrawn one', () => {
    expect(LIGHT.bg).toBe('#bcc5dd');
    expect(LIGHT.bg).not.toBe('#c3cade');
  });

  it('gives muted #4a4f63 and textSubtle #43485a, per conventions.md', () => {
    // HANDOFF.md §1 published #43485a as --color-muted; conventions.md:101-105
    // reassigns it to textSubtle, the one neutral that passes on every ground.
    expect(LIGHT.textSubtle).toBe('#43485a');
    expect(LIGHT.muted).toBe('#4a4f63');
  });

  it('keeps cycling distinct from positive', () => {
    // Both sides rejected folding these: positive is done/UT1/lower strength,
    // cycling is the discipline. Same-looking greens, different jobs.
    expect(LIGHT.cycling).not.toBe(LIGHT.positive);
    expect(DARK.cycling).not.toBe(DARK.positive);
  });
});

describe('DEFAULT_THEME', () => {
  it('is one of the two palettes', () => {
    expect([DARK, LIGHT]).toContain(DEFAULT_THEME);
  });
});

describe('the literals the seam left behind', () => {
  // Five dark-palette hexes were still written out longhand in view source after
  // the flip — the header gradient's far stop, the today card's, every
  // `linear-gradient(...,#1e1e30)` second stop, `color:'#fff'`, and `'#888'`.
  // On light they kept painting dark: the stat-tile values went white-on-white
  // and vanished from the desktop overview entirely.
  //
  // Each was replaced by the token whose DARK value it already was, so the swap
  // is a no-op on dark. 'locks the canonical values' above holds that half. What
  // it does not state is the premise the two shorthands rest on, and those cover
  // 33 of the 47 sites — so state it here rather than leave it assumed.
  const expand = (hex) =>
    hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;

  it.each([['#fff', 'textStrong']])(
    '%s is shorthand for DARK.%s',
    (hex, key) => {
      expect(DARK[key]).toBe(expand(hex));
    }
  );

  it.each([
    ['#0d0e12', 'bg'],
    ['#1e2027', 'raised'],
    ['#121318', 'surfaceAlt'],
  ])('%s is DARK.%s', (hex, key) => {
    expect(DARK[key]).toBe(hex);
  });

  it.each(['bg', 'raised', 'surfaceAlt', 'textStrong', 'neutralAccent'])(
    'LIGHT.%s differs from DARK — the substitution is what moves on light',
    (key) => {
      expect(LIGHT[key]).not.toBe(DARK[key]);
    }
  );
});
