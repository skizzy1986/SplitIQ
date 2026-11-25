import { useEffect, useRef, useState } from 'react';
import { readLiveErgFlag } from '../live-erg/liveErgFlag.js';
import { unlockCueAudio } from '../services/cueAudio.js';
import {
  markCuesOnboarded,
  readCueVoice,
  readCuesEnabled,
  readCuesOnboarded,
} from '../utils/cueSettings.js';

// The cues that come from the PM5 connection and the save, not from a sample
// (#785). They read `status` here in ErgLiveView on purpose: usePM5 sets the
// last sample and the finished status in one callback, so the live screen
// unmounts before it ever renders the end sample, and its tracker never sees
// the piece finish. The player is loaded only when the cues are on.
const loadRuntime = () => import('../services/cueRuntime.js');

export function useCueLifecycle(status, saveState, storage) {
  const [on] = useState(
    () => readLiveErgFlag(storage) && readCuesEnabled(storage)
  );
  const prevStatus = useRef(status);
  const prevSave = useRef(saveState);

  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = status;
    if (!on || status === before) return;
    const voice = readCueVoice(storage);
    if (status === 'connected') {
      const first = !readCuesOnboarded(storage);
      if (first) markCuesOnboarded(storage);
      loadRuntime().then((rt) =>
        rt.playLifecycle(first ? 'onboard' : 'session_start', voice)
      );
    } else if (status === 'finished' && before !== 'idle') {
      loadRuntime().then((rt) => rt.playLifecycle('finish', voice));
    } else if (status === 'idle' || status === 'error') {
      loadRuntime().then((rt) => {
        rt.getCueRuntime().player.cancelAll();
        rt.getCueRuntime().player.setMuted(false);
      });
    }
  }, [on, status, storage]);

  useEffect(() => {
    const before = prevSave.current;
    prevSave.current = saveState;
    if (!on || saveState === before) return;
    if (saveState === 'saved' || saveState === 'queued') {
      loadRuntime().then((rt) =>
        rt.playLifecycle('session_end', readCueVoice(storage))
      );
    }
  }, [on, saveState, storage]);

  useEffect(
    () => () => {
      if (!on) return;
      loadRuntime().then((rt) => {
        const { player } = rt.getCueRuntime();
        player.cancelAll();
        player.setMuted(false);
      });
    },
    [on]
  );

  return {
    // Call inside the tap that connects: the audio context only starts there.
    unlock() {
      if (on) unlockCueAudio();
    },
  };
}
