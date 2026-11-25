import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Voice cues (#785) around ErgLiveView: the audio unlock on the connect tap,
// and the lifecycle cues read from `status`. The finish cue must come from
// here: usePM5 sets the last sample and `finished` in one callback, so the
// live screen unmounts before it renders the end sample.
let pm5State;
const player = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  setMuted: vi.fn(),
}));
const playLifecycle = vi.hoisted(() => vi.fn(() => Promise.resolve('started')));
const unlockCueAudio = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      select: () => ({ is: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));
vi.mock('../../hooks/usePM5', () => ({ usePM5: () => pm5State }));
vi.mock('../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ addToQueue: vi.fn(), pending: 0 }),
}));
vi.mock('../../services/cueAudio.js', () => ({ unlockCueAudio }));
vi.mock('../../services/cueRuntime.js', () => ({
  playLifecycle,
  playIntent: vi.fn(),
  warmVoice: vi.fn(),
  getCueRuntime: () => ({
    player: { ...player, subscribe: () => () => {}, isMuted: () => false },
  }),
}));

import ErgLiveView from '../ErgLiveView.jsx';
import { LIVE_ERG_FLAG_KEY } from '../../live-erg/liveErgFlag.js';
import {
  CUES_ENABLED_KEY,
  CUES_ONBOARDED_KEY,
  CUES_VOICE_KEY,
} from '../../utils/cueSettings.js';

const SAMPLE = {
  elapsedTime: 1200,
  distance: 5000,
  workoutState: 10,
  rowingState: 0,
  strokeRate: 22,
  pace500: 12000,
  paceStr: '2:00.0',
  watts: 203,
  elapsedStr: '20:00',
  calories: 0,
};
const SUMMARY = {
  distance: 5000,
  elapsedTime: 1200,
  elapsedStr: '20:00',
  avgWatts: 180,
  avgPace: 12000,
  avgSpm: 24,
  maxWatts: 220,
  calories: 250,
};

function base(over = {}) {
  return {
    status: 'idle',
    metrics: null,
    summary: null,
    error: null,
    connect: vi.fn(),
    reset: vi.fn(),
    finish: vi.fn(),
    disconnect: vi.fn(),
    monitors: [],
    scanPhase: 'scanning',
    choose: vi.fn(),
    retryScan: vi.fn(),
    cancelScan: vi.fn(),
    ...over,
  };
}

function tree() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ErgLiveView />
    </QueryClientProvider>
  );
}

function turnOn() {
  window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
  window.localStorage.setItem(CUES_ENABLED_KEY, '1');
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  pm5State = base();
});
afterEach(() => window.localStorage.clear());

describe('ErgLiveView voice cues', () => {
  it('does nothing without both beta switches', async () => {
    window.localStorage.setItem(CUES_ENABLED_KEY, '1'); // live screen off
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText('CONNECT TO PM5'));
    expect(unlockCueAudio).not.toHaveBeenCalled();
    expect(pm5State.connect).toHaveBeenCalledTimes(1);
    pm5State = base({ status: 'connected' });
    rerender(tree());
    await flush();
    expect(playLifecycle).not.toHaveBeenCalled();
  });

  it('starts the audio inside the planner connect tap, then connects', async () => {
    turnOn();
    render(tree());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect to PM5' })
    );
    expect(unlockCueAudio).toHaveBeenCalledTimes(1);
    expect(pm5State.connect).toHaveBeenCalledTimes(1);
    expect(unlockCueAudio.mock.invocationCallOrder[0]).toBeLessThan(
      pm5State.connect.mock.invocationCallOrder[0]
    );
  });

  it('plays the onboarding once, then the session start', async () => {
    turnOn();
    window.localStorage.setItem(CUES_VOICE_KEY, 'technical');
    const { rerender, unmount } = render(tree());
    pm5State = base({ status: 'connected' });
    rerender(tree());
    await flush();
    expect(playLifecycle).toHaveBeenLastCalledWith('onboard', 'technical');
    expect(window.localStorage.getItem(CUES_ONBOARDED_KEY)).toBe('1');
    unmount();
    pm5State = base();
    const second = render(tree());
    pm5State = base({ status: 'connected' });
    second.rerender(tree());
    await flush();
    expect(playLifecycle).toHaveBeenLastCalledWith(
      'session_start',
      'technical'
    );
  });

  it('plays the finish cue when the PM5 ends the piece, though the live screen unmounts first', async () => {
    turnOn();
    window.localStorage.setItem(CUES_ONBOARDED_KEY, '1');
    pm5State = base({
      status: 'rowing',
      metrics: { ...SAMPLE, workoutState: 1 },
    });
    const { rerender } = render(tree());
    expect(await screen.findByTestId('live-erg-session')).toBeInTheDocument();
    // One callback: the end sample and `finished` land in the same render.
    pm5State = base({ status: 'finished', metrics: SAMPLE, summary: SUMMARY });
    rerender(tree());
    await flush();
    expect(screen.queryByTestId('live-erg-session')).not.toBeInTheDocument();
    expect(playLifecycle).toHaveBeenCalledWith('finish', 'dry');
    expect(
      playLifecycle.mock.calls.filter(([e]) => e === 'finish')
    ).toHaveLength(1);
  });

  it('plays the finish cue for a manual END too, which also sets finished', async () => {
    turnOn();
    pm5State = base({ status: 'connected' });
    const { rerender } = render(tree());
    pm5State = base({ status: 'finished', summary: SUMMARY });
    rerender(tree());
    await flush();
    expect(playLifecycle).toHaveBeenCalledWith('finish', 'dry');
  });

  it('does not play a finish cue when no piece was connected', async () => {
    turnOn();
    const { rerender } = render(tree());
    pm5State = base({ status: 'finished', summary: SUMMARY });
    rerender(tree());
    await flush();
    expect(playLifecycle).not.toHaveBeenCalledWith('finish', expect.anything());
  });

  it('stops the cues when the PM5 drops and when the view closes', async () => {
    turnOn();
    pm5State = base({
      status: 'rowing',
      metrics: { ...SAMPLE, workoutState: 1 },
    });
    const { rerender, unmount } = render(tree());
    pm5State = base({ status: 'error', error: 'lost' });
    rerender(tree());
    await flush();
    expect(player.cancelAll).toHaveBeenCalled();
    expect(player.setMuted).toHaveBeenCalledWith(false);
    player.cancelAll.mockClear();
    unmount();
    await flush();
    expect(player.cancelAll).toHaveBeenCalled();
  });
});
