import { getCueAudio } from './cueAudio.js';
import { createCuePlayer } from './cuePlayer.js';
import {
  createRotation,
  resolveIntent,
  warmStems,
} from '../utils/cueStitch.js';
import { VOICES, readCueVoice } from '../utils/cueSettings.js';

// The one player and one rotation for the app, shared by the live screen, the
// lifecycle cues and the Settings test button.
let runtime = null;

export function getCueRuntime() {
  if (!runtime) {
    const player = createCuePlayer({ getContext: getCueAudio });
    runtime = { player, rotation: createRotation(Date.now() % 2 ** 31) };
    if (typeof document !== 'undefined') {
      // Nothing speaks once the app is in the background.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) player.cancelAll();
      });
    }
  }
  return runtime;
}

export async function playIntent(intent, voiceKey = readCueVoice()) {
  const { player, rotation } = getCueRuntime();
  const index = await player.getIndex();
  if (!index) return 'no-index';
  const cue = resolveIntent(intent, {
    voice: VOICES[voiceKey],
    index,
    rotation,
  });
  return cue ? player.play(cue) : 'silent';
}

export async function warmVoice(voiceKey, targetW) {
  const { player } = getCueRuntime();
  const index = await player.getIndex();
  if (index)
    player.warm(warmStems({ voice: VOICES[voiceKey], index, targetW }));
}

const LIFECYCLE = {
  finish: {
    line: 'finish',
    priority: 0,
    ttlMs: 30000,
    tone: 'end_sting',
    toneAfter: true,
  },
  session_start: { line: 'session_start', priority: 0, ttlMs: 4000 },
  session_end: { line: 'session_end', priority: 0, ttlMs: 8000 },
  onboard: { line: 'onboard', priority: 0, ttlMs: 8000 },
  // Settings: a tone then one line, to hear what the phone does to music.
  test: { line: 'session_start', priority: 0, ttlMs: 8000, tone: 'hit' },
};

export function playLifecycle(event, voiceKey) {
  return playIntent({ event, voiced: true, ...LIFECYCLE[event] }, voiceKey);
}
