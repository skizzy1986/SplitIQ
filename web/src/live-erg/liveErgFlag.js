import { safeStorage } from '../utils/themePreference.js';

// Opt-in for the v10 live screen while it is in beta. Off unless the athlete
// turns it on, so ErgLiveView keeps today's rowing screen by default.
export const LIVE_ERG_FLAG_KEY = 'splitiq.liveErg';
export const LIVE_ERG_FLAG_ON = 'v10';
export const LIVE_ERG_WORKOUT_KEY = 'splitiq.liveErg.workout';

function storageOf(storage) {
  if (storage !== undefined) return storage;
  return typeof window === 'undefined' ? null : safeStorage(window);
}

export function readLiveErgFlag(storage) {
  try {
    return storageOf(storage)?.getItem(LIVE_ERG_FLAG_KEY) === LIVE_ERG_FLAG_ON;
  } catch {
    return false;
  }
}

export function writeLiveErgFlag(on, storage) {
  try {
    const s = storageOf(storage);
    if (!s) return false;
    if (on) s.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    else s.removeItem(LIVE_ERG_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

// The last workout built on the v10 screen, so the plan survives a reconnect.
export function readSavedWorkout(storage) {
  try {
    const raw = storageOf(storage)?.getItem(LIVE_ERG_WORKOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && parsed.type ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWorkout(workout, storage) {
  try {
    storageOf(storage)?.setItem(LIVE_ERG_WORKOUT_KEY, JSON.stringify(workout));
  } catch {
    // Storage full or blocked: the plan still works for this piece.
  }
}
