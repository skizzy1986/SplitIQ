import { captureError } from '../utils/sentry.js';

// The one AudioContext the cues play through. It is created inside the
// athlete's tap (Start, connect, or the Settings test button) because
// browsers and WebViews start a context suspended and only let a user gesture
// resume it; without that the first cue would be silent. Kept apart from the
// player so the screen that owns the tap does not pull the player in.
let ctx = null;

function defaultCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function unlockCueAudio(Ctor = defaultCtor()) {
  try {
    if (!ctx) {
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        captureError(err, { source: 'cueAudio', step: 'resume' });
      });
    }
    return ctx;
  } catch (err) {
    captureError(err, { source: 'cueAudio', step: 'create' });
    return null;
  }
}

export function getCueAudio() {
  return ctx;
}

export function resetCueAudioForTest() {
  ctx = null;
}
