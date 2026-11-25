import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Voice cues (#785) on the v10 live screen: the triggers run on each new
// sample, the mute button shows only when the cues are on, and with either
// beta switch off nothing runs at all.
const playIntent = vi.hoisted(() => vi.fn(() => Promise.resolve('started')));
const warmVoice = vi.hoisted(() => vi.fn());
const muteState = vi.hoisted(() => ({ muted: false, listeners: new Set() }));
const player = vi.hoisted(() => ({
  setMuted: (v) => {
    muteState.muted = v;
    muteState.listeners.forEach((fn) => fn());
  },
  isMuted: () => muteState.muted,
  subscribe: (fn) => {
    muteState.listeners.add(fn);
    return () => muteState.listeners.delete(fn);
  },
}));
vi.mock('../../supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../../services/cueRuntime.js', () => ({
  playIntent,
  warmVoice,
  getCueRuntime: () => ({ player }),
}));

import { LiveErgSessionView } from '../LiveErgSession.jsx';
import { LIVE_ERG_FLAG_KEY } from '../liveErgFlag.js';
import { CUES_ENABLED_KEY, CUES_VOICE_KEY } from '../../utils/cueSettings.js';

function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const plan = {
  type: 'int',
  ints: [
    { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
    { work: 1000, unit: 'm', rest: 0, watts: 185, rate: 22 },
  ],
  reps: 2,
};
const savedPlan = { 'splitiq.liveErg.workout': JSON.stringify(plan) };
const on = {
  [LIVE_ERG_FLAG_KEY]: 'v10',
  [CUES_ENABLED_KEY]: '1',
  [CUES_VOICE_KEY]: 'encouraging',
  ...savedPlan,
};

function sample(elapsedTime, distance, workoutState) {
  return {
    elapsedTime,
    distance,
    workoutState,
    rowingState: 1,
    strokeRate: 24,
    pace500: 12000,
    watts: 210,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  muteState.muted = false;
  muteState.listeners.clear();
});

describe('LiveErgSessionView voice cues', () => {
  it('says start on the first work sample, in the chosen voice', () => {
    const storage = memory(on);
    const { rerender } = render(
      <LiveErgSessionView storage={storage} metrics={sample(0, 0, 0)} />
    );
    expect(playIntent).not.toHaveBeenCalled();
    expect(warmVoice).toHaveBeenCalledWith('encouraging', 210);
    rerender(
      <LiveErgSessionView storage={storage} metrics={sample(1, 3, 5)} />
    );
    expect(playIntent).toHaveBeenCalledTimes(1);
    expect(playIntent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'go', line: 'start', priority: 0 }),
      'encouraging'
    );
  });

  it('does not run the same sample twice when the plan changes', () => {
    const storage = memory(on);
    const m = sample(1, 3, 5);
    const { rerender } = render(
      <LiveErgSessionView storage={storage} metrics={m} />
    );
    rerender(<LiveErgSessionView storage={storage} metrics={m} />);
    expect(playIntent).toHaveBeenCalledTimes(1);
  });

  it('does nothing with the cues off, or with the live-screen switch off', () => {
    for (const seed of [
      { ...savedPlan, [LIVE_ERG_FLAG_KEY]: 'v10' },
      { ...savedPlan, [CUES_ENABLED_KEY]: '1' },
    ]) {
      const storage = memory(seed);
      render(
        <LiveErgSessionView storage={storage} metrics={sample(1, 3, 5)} />
      );
      expect(screen.queryByTestId('cue-mute')).not.toBeInTheDocument();
    }
    expect(playIntent).not.toHaveBeenCalled();
    expect(warmVoice).not.toHaveBeenCalled();
  });

  it('mutes and unmutes from the live screen', () => {
    render(
      <LiveErgSessionView storage={memory(on)} metrics={sample(0, 0, 0)} />
    );
    const button = screen.getByTestId('cue-mute');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAccessibleName('Mute voice cues');
    fireEvent.click(button);
    expect(muteState.muted).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName('Unmute voice cues');
    fireEvent.click(button);
    expect(muteState.muted).toBe(false);
  });
});
