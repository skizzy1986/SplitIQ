// First-run guide state for the testers build (#797). Stored per account on
// this device, so a second tester on the same phone is not skipped, and a
// reload does not replay the walkthrough once it has been finished or skipped.
import { SAMPLE_SOURCE } from '../constants/sampleSource.js';

export { SAMPLE_SOURCE };

const prefix = 'splitiq.testers.firstRunGuide.v1:';
const CARD_PREFIX = 'splitiq.testers.welcomeCard.v1:';

export const MIN_CP = 50;
export const MAX_CP = 500;

export function guideStorageKey(userId) {
  return `${prefix}${userId ?? ''}`;
}

export function cardStorageKey(userId) {
  return `${CARD_PREFIX}${userId ?? ''}`;
}

export function isGuideDismissed(userId, storage = localStorage) {
  if (!userId) return true;
  try {
    return storage.getItem(guideStorageKey(userId)) === 'done';
  } catch {
    return false;
  }
}

const closeListeners = new Set();

// Told when the guide is finished or skipped, so the strap-or-RPE screen
// (#819) can follow it without the guide knowing about that screen.
export function onGuideClosed(fn) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}

export function dismissGuide(userId, storage = localStorage) {
  if (!userId) return;
  try {
    storage.setItem(guideStorageKey(userId), 'done');
  } catch {
    // Private mode can refuse writes; the guide will simply show again.
  }
  closeListeners.forEach((fn) => fn());
}

export function reopenGuide(userId, storage = localStorage) {
  if (!userId) return;
  try {
    storage.removeItem(guideStorageKey(userId));
  } catch {
    /* ignore */
  }
}

export function isWelcomeCardDismissed(userId, storage = localStorage) {
  if (!userId) return true;
  try {
    return storage.getItem(cardStorageKey(userId)) === 'done';
  } catch {
    return false;
  }
}

export function dismissWelcomeCard(userId, storage = localStorage) {
  if (!userId) return;
  try {
    storage.setItem(cardStorageKey(userId), 'done');
  } catch {
    /* ignore */
  }
}

/** A whole number of watts in the accepted range, or null. */
export function parseRowingCp(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (n < MIN_CP || n > MAX_CP) return null;
  return n;
}

export function isSampleSession(session) {
  return (session?.source ?? '') === SAMPLE_SOURCE;
}

const openListeners = new Set();

export function onGuideOpenRequest(fn) {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

export function requestGuideOpen(userId, storage = localStorage) {
  reopenGuide(userId, storage);
  openListeners.forEach((fn) => fn());
}
