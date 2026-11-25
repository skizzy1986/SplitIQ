import { safeStorage } from './themePreference.js';

// Voice cue settings (#785). Local to the phone, off by default: the cues are
// a beta on top of the v10 live screen and need both switches.
export const CUES_ENABLED_KEY = 'splitiq.cues.enabled';
export const CUES_VOICE_KEY = 'splitiq.cues.voice';
export const CUES_CHATTER_KEY = 'splitiq.cues.chatter';
export const CUES_ONBOARDED_KEY = 'splitiq.cues.onboarded';

// Setting value -> folder under /audio/cues/.
export const VOICES = {
  dry: 'dry',
  encouraging: 'enc',
  technical: 'tech',
};
export const DEFAULT_VOICE = 'dry';
export const CHATTER_LEVELS = ['quiet', 'standard', 'chatty'];
export const DEFAULT_CHATTER = 'standard';

function storageOf(storage) {
  if (storage !== undefined) return storage;
  return typeof window === 'undefined' ? null : safeStorage(window);
}

function read(key, storage) {
  try {
    return storageOf(storage)?.getItem(key) ?? null;
  } catch {
    // Blocked storage reads as "never set".
    return null;
  }
}

function write(key, value, storage) {
  try {
    const s = storageOf(storage);
    if (!s) return false;
    if (value == null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readCuesEnabled(storage) {
  return read(CUES_ENABLED_KEY, storage) === '1';
}

export function writeCuesEnabled(on, storage) {
  return write(CUES_ENABLED_KEY, on ? '1' : null, storage);
}

export function readCueVoice(storage) {
  const v = read(CUES_VOICE_KEY, storage);
  return Object.hasOwn(VOICES, v) ? v : DEFAULT_VOICE;
}

export function writeCueVoice(voice, storage) {
  return Object.hasOwn(VOICES, voice)
    ? write(CUES_VOICE_KEY, voice, storage)
    : false;
}

export function readCueChatter(storage) {
  const v = read(CUES_CHATTER_KEY, storage);
  return CHATTER_LEVELS.includes(v) ? v : DEFAULT_CHATTER;
}

export function readCuesOnboarded(storage) {
  return read(CUES_ONBOARDED_KEY, storage) === '1';
}

export function markCuesOnboarded(storage) {
  return write(CUES_ONBOARDED_KEY, '1', storage);
}
