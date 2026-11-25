import { useEffect, useRef, useState } from 'react';
import { readLiveErgFlag } from '../live-erg/liveErgFlag.js';
import { bandForInterval } from '../live-erg/intervalModel.js';
import { playIntent, warmVoice } from '../services/cueRuntime.js';
import {
  readCueChatter,
  readCueVoice,
  readCuesEnabled,
} from '../utils/cueSettings.js';
import { createCueState, detectCues } from '../utils/cueTriggers.js';

// Runs the cue triggers on each new PM5 sample (#785). Off unless the athlete
// turned on both the new live screen and Voice cues (beta); then it does
// nothing at all. The settings are read once, when the piece starts.
export function useWorkoutCues({ metrics, tracker, workout, storage }) {
  const [settings] = useState(() => ({
    on: readLiveErgFlag(storage) && readCuesEnabled(storage),
    voice: readCueVoice(storage),
    chatter: readCueChatter(storage),
  }));
  const stateRef = useRef(null);
  const seenRef = useRef(null);

  useEffect(() => {
    if (!settings.on) return;
    warmVoice(settings.voice, bandForInterval(workout, 1)?.target);
    // Once per piece: the clips decoded now are the ones the first cues need.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    if (!settings.on || !metrics || seenRef.current === metrics) return;
    seenRef.current = metrics;
    const { state, intents } = detectCues(
      stateRef.current ?? createCueState(),
      {
        sample: metrics,
        tracker,
        workout,
        nowMs: globalThis.performance.now(),
        chatter: settings.chatter,
      }
    );
    stateRef.current = state;
    for (const intent of intents) playIntent(intent, settings.voice);
  }, [settings, metrics, tracker, workout]);
}
