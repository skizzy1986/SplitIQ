import { checkBuffer, checkManifest } from '../../anatomy/utils/manifest.js';

// The squat's binding of the shared manifest check (anatomy/utils/manifest.js):
// a rep timeline, in one bin.

/**
 * Structural checks a broken or mismatched download would fail. Returns the
 * number of arrays checked; throws with the first problem found.
 */
export function validateManifest(manifest, buffer) {
  const names = checkManifest(manifest, 'rep');
  if (buffer) checkBuffer(manifest, buffer);
  return names.length;
}
