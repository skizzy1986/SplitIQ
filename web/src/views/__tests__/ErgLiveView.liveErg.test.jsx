import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The v10 live screen behind its beta opt-in (#768). Connecting, the PM5
// list, the summary and saving stay ErgLiveView's own either way.
let pm5State;
const finishMock = vi.fn();

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      select: () => ({
        is: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));
vi.mock('../../hooks/usePM5', () => ({ usePM5: () => pm5State }));
vi.mock('../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ addToQueue: vi.fn(), pending: 0 }),
}));

import ErgLiveView from '../ErgLiveView.jsx';
import { LIVE_ERG_FLAG_KEY } from '../../live-erg/liveErgFlag.js';

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ErgLiveView />
    </QueryClientProvider>
  );
}

const SAMPLE = {
  elapsedTime: 0,
  distance: 0,
  workoutState: 1,
  rowingState: 1,
  strokeRate: 22,
  pace500: 12000,
  paceStr: '2:00.0',
  watts: 203,
  elapsedStr: '0:00',
  calories: 0,
};

beforeEach(() => {
  finishMock.mockReset();
  window.localStorage.removeItem(LIVE_ERG_FLAG_KEY);
  pm5State = {
    status: 'rowing',
    metrics: SAMPLE,
    summary: null,
    error: null,
    connect: vi.fn(),
    reset: vi.fn(),
    finish: finishMock,
    disconnect: vi.fn(),
    monitors: [],
    scanPhase: 'searching',
    connectingId: null,
    locationOff: false,
    errorCode: null,
    choose: vi.fn(),
    retryScan: vi.fn(),
    cancelScan: vi.fn(),
  };
});

afterEach(() => {
  window.localStorage.removeItem(LIVE_ERG_FLAG_KEY);
});

describe('ErgLiveView v10 opt-in', () => {
  it('keeps today’s rowing screen when the opt-in is off', () => {
    renderView();
    expect(screen.getByText('END')).toBeInTheDocument();
    expect(screen.queryByTestId('live-erg-session')).not.toBeInTheDocument();
  });

  it('swaps in the lazy v10 screen mid-piece when the opt-in is on', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    renderView();
    expect(await screen.findByTestId('live-erg-session')).toBeInTheDocument();
    expect(screen.queryByText('END')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End piece' }));
    expect(finishMock).toHaveBeenCalledTimes(1);
  });

  it('puts the PM5 list on the planner, not a standalone page, with the opt-in on', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    pm5State = { ...pm5State, status: 'choosing', metrics: null };
    renderView();
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(screen.getByText('Choose your PM5')).toBeVisible();
    expect(screen.getByTestId('live-erg-interval-builder')).toBeVisible();
    expect(screen.queryByTestId('live-erg-session')).not.toBeInTheDocument();
    expect(screen.queryByText('C2 CONNECT')).toBeNull();
  });

  it('opens the planner, not the standalone connect page, while idle', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    pm5State = { ...pm5State, status: 'idle', metrics: null };
    renderView();
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Connect to PM5' })
    ).toBeVisible();
    expect(screen.queryByText('CONNECT TO PM5')).toBeNull();
    expect(screen.queryByText('C2 CONNECT')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('Start on the planner opens the live screen once the PM5 is connected', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    pm5State = { ...pm5State, status: 'connected', metrics: null };
    renderView();
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(screen.getByText('PM5 connected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByTestId('live-erg-session')).toBeVisible();
    expect(
      screen.getByText(/Your saved plan is loaded|Build your intervals here/)
    ).toBeVisible();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
  });

  it('advances to the live screen if rowing starts before Start is tapped', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    pm5State = { ...pm5State, status: 'rowing', metrics: SAMPLE };
    renderView();
    expect(await screen.findByTestId('live-erg-session')).toBeVisible();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
  });

  it('still uses the standalone connect page when the opt-in is off', () => {
    pm5State = { ...pm5State, status: 'idle', metrics: null };
    renderView();
    expect(screen.getByText('CONNECT TO PM5')).toBeInTheDocument();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
  });

  it('leaves the summary screen alone with the opt-in on', () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    pm5State = {
      ...pm5State,
      status: 'finished',
      summary: {
        distance: 5000,
        elapsedTime: 1200,
        elapsedStr: '20:00',
        avgWatts: 180,
        avgPace: 12000,
        avgSpm: 24,
        maxWatts: 220,
        calories: 250,
      },
    };
    renderView();
    expect(screen.getByText('SAVE SESSION')).toBeInTheDocument();
    expect(screen.queryByTestId('live-erg-session')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-erg-planner')).not.toBeInTheDocument();
  });
});
