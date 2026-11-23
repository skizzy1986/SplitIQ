// The one-dataset-two-depths preference (VISION, "One dataset, two depths").
// Pure and storage-safe, no React and no product imports, and it reuses
// themePreference's safeStorage rather than keeping a second copy of it.
//
// The key is the app-wide `splitiq.depth`, a sibling of `splitiq.theme`, not a
// screen-scoped one: when depth goes past the live erg screen this module is
// read as it stands, with no migration.
import { safeStorage } from './themePreference.js';

export const DEPTH_KEY = 'splitiq.depth';
export const DEPTH_SIMPLE = 'simple';
export const DEPTH_EXPERT = 'expert';
export const DEPTHS = [DEPTH_SIMPLE, DEPTH_EXPERT];

export function readDepthPref(storage) {
  try {
    const v = storage?.getItem(DEPTH_KEY);
    return DEPTHS.includes(v) ? v : DEPTH_SIMPLE;
  } catch {
    // Storage blocked (private mode, sandboxed iframe): the simple depth is
    // the default and it is complete.
    return DEPTH_SIMPLE;
  }
}

export function writeDepthPref(storage, value) {
  if (!DEPTHS.includes(value)) return;
  try {
    storage?.setItem(DEPTH_KEY, value);
  } catch {
    // The choice still applies for this visit when persistence is blocked.
  }
}

// The two window-level helpers a caller uses; they keep the storage lookup in
// this module, so a screen reading a depth imports nothing else.
export function initialDepth(win = window) {
  return readDepthPref(safeStorage(win));
}

export function storeDepth(win, value) {
  writeDepthPref(safeStorage(win), value);
}
