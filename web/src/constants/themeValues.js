// The palette's literal values. THEME (theme.js) is a pointer table of
// var(--color-*) strings; this module is what those variables resolve to and
// the only place a hex is written down.
//
// Split out for the token seam (#250): cssVars() must read values, not THEME,
// or it emits `--color-accent: var(--color-accent)` and resolves to nothing.
export const DARK = {
  bg: '#0d0e12',
  surface: '#16171d',
  raised: '#1e2027',
  field: '#1e2027',
  border: '#2a2d36',
  text: '#f3f4f6',
  muted: '#a9adba',
  accent: '#5cc8e8',
  positive: '#6fd69a',
  caution: '#f0c75e',
  warning: '#ff9b6a',
  critical: '#ff6f86',
  accentAlt: '#c4b5fd',
  accentAlt2: '#f0a3c8',
  cycling: '#5eead4',
  surfaceAlt: '#121318',
  surfaceDeep: '#090a0e',
  neutral: '#4a4e5a',
  textSubtle: '#a9adba',
  textFaint: '#8a8f9c',
  textDim: '#5c6170',
  divider: '#2a2d36',
  neutralAccent: '#8a8f9c',
  textStrong: '#ffffff',
  // Provenance inks for the squat tool (squat tool, PR1): a value the model
  // computed versus one a sensor recorded. Additive — no existing key moved.
  modelled: '#f2b45a',
  measured: '#86a8ff',
  // The squat tool's 3D scene (PR2). Not text inks: these paint geometry, so
  // they are named for what they colour, not for a movement — a second
  // exercise reuses them. Dark muscle and tendon are the source page's own.
  anatomyMuscle: '#a52529',
  anatomyTendon: '#d5dbe0',
  anatomyBone: '#e6dccb',
  anatomyShadow: '#000004',
  anatomyBar: '#9aa3b5',
  // The activation heatmap's ramp stops (SKINNING.md RAMP), read two ways: the
  // scene turns them into raw 0-1 channels, the legend prints them as swatches.
  // Both themes start on the same four, as the source page had them — the
  // convention anatomyMuscle/anatomyTendon already follow.
  anatomyHeatLow: '#3d5a8c',
  anatomyHeatMid: '#8c3b6b',
  anatomyHeatHigh: '#cf3a2a',
  anatomyHeatPeak: '#ffd35c',
  // A muscle picked in the list, painted on the model with the heatmap off.
  // Cyan, as far from the muscle reds and the ramp as the palette goes.
  anatomyFocus: '#4cd4f5',
  // Additive v10 live-session tokens (#771). onAccent is the ink on accent
  // fills (white on #5cc8e8 is 1.9:1). bandAmber / bandCoral are for under-
  // and over-band chart bars and arrow marks only — not caution, warning or
  // modelled, which already mean other things.
  onAccent: '#06222c',
  bandAmber: '#e8b45c',
  bandCoral: '#e87a5c',
  // Recovery pace-zone swatch. The source literal was '#666'; both palettes
  // keep #666666 so neither theme changes colour until design sets a light
  // value. See SHARED_BY_DESIGN in theme.test.js.
  zoneRecovery: '#666666',
  // The rower's scene (#827; #757 wires the erg, #761 the skin and clothes).
  // Named for what they paint, like the anatomy* tokens, and additive: nothing
  // above moved. sceneClothesAlt is the ground the SplitIQ mark sits on, so
  // accent (the mark) and positive (the wordmark) must clear AA on it; the
  // erg and the clothes must hold 3:1 against the stage. DESIGN.md has the
  // measured ratios.
  sceneSkin: '#c98f6f',
  sceneClothes: '#2f8196',
  sceneClothesAlt: '#0b0e16',
  sceneErg: '#cdd3de',
};

// The light palette. Values are conventions.md's, which is design-owned and
// CI-verified, not HANDOFF.md §1's — §1 published --color-muted #43485a, and
// conventions.md:101-105 reassigns that value to textSubtle (the one neutral
// that passes on every ground) and gives muted #4a4f63. The ground is #bcc5dd;
// §1's #c3cade is withdrawn.
//
// Three keys the light spec does not cover, called out rather than guessed at
// silently:
//   surfaceDeep   the far end of the splash gradient (splashCss.js). Set midway
//                 between the inset and the ground so it still recedes.
//   neutralAccent 10-11px caption text on a card, so it needs AA — textFaint
//                 would not clear 4.5. Same value as muted; a fold candidate.
//   textStrong    maximum-contrast ink. On light that is `text`. Also a fold
//                 candidate, but kept so call sites need no edit.
export const LIGHT = {
  bg: '#bcc5dd',
  surface: '#ffffff',
  raised: '#ffffff',
  field: '#f4f7fc',
  border: '#c8cee0',
  text: '#1c1e2a',
  muted: '#4a4f63',
  accent: '#0a7093',
  positive: '#10795a',
  caution: '#8a6a10',
  warning: '#a34c1c',
  critical: '#a32040',
  accentAlt: '#5f45b0',
  accentAlt2: '#a3407a',
  cycling: '#10786c',
  surfaceAlt: '#eef4fb',
  surfaceDeep: '#d5dded',
  neutral: '#98a1bb',
  textSubtle: '#43485a',
  textFaint: '#767c92',
  textDim: '#98a1bb',
  divider: '#e4e7ef',
  neutralAccent: '#4a4f63',
  textStrong: '#1c1e2a',
  // Squat-tool provenance inks; both clear AA (4.5) on surface and field.
  modelled: '#8a5300',
  measured: '#2a55c4',
  // 3D scene; a touch deeper than dark so the model holds on a light stage.
  anatomyMuscle: '#b3363a',
  anatomyTendon: '#b4bcc6',
  anatomyBone: '#c9bca3',
  anatomyShadow: '#2a3350',
  anatomyBar: '#5d667a',
  // Source parity with DARK: the ramp paints geometry, not ink anyone reads.
  anatomyHeatLow: '#3d5a8c',
  anatomyHeatMid: '#8c3b6b',
  anatomyHeatHigh: '#cf3a2a',
  anatomyHeatPeak: '#ffd35c',
  anatomyFocus: '#48cdee',
  // Companions for the v10 tokens. onAccent is white: the light accent is
  // dark enough (5.6:1). Band colours are deeper than dark so marks hold
  // on a white surface (chart/UI contrast, not body text).
  onAccent: '#ffffff',
  bandAmber: '#c08810',
  bandCoral: '#c86838',
  // Same source hex as DARK: the Recovery band was a raw literal, so it
  // already painted this on light. A distinct light value is a design call.
  zoneRecovery: '#666666',
  // Rower's scene (#827). Skin and erg sit deeper than dark's so they hold on
  // the pale stage; clothes are a deep teal, and the mark's ground is near
  // white so the light accent reads on it.
  sceneSkin: '#d29c78',
  sceneClothes: '#0b5d7a',
  sceneClothesAlt: '#f4f7fc',
  sceneErg: '#6b748a',
};

// The palette the document boots on. Dark is the signed-in dashboard's only
// theme. LIGHT stays so /squat can still resolve to it and so a light
// dashboard can return later. index.html's pre-mount ground, the PWA manifest
// and the Android launch colours all mirror this, so the ground is written
// down once. Flipping the app's default theme is a change to this line.
export const DEFAULT_THEME = DARK;
