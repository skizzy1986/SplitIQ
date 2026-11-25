import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../../i18n/views.js';

vi.mock('../../../supabaseClient', () => ({
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
vi.mock('../../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ addToQueue: vi.fn(), pending: 0 }),
}));
let pm5State = {
  status: 'idle',
  metrics: null,
  summary: null,
  error: null,
  errorCode: null,
  connect: vi.fn(),
  reset: vi.fn(),
  finish: vi.fn(),
  disconnect: vi.fn(),
  monitors: [],
  scanPhase: 'searching',
  connectingId: null,
  locationOff: false,
  choose: vi.fn(),
  retryScan: vi.fn(),
  cancelScan: vi.fn(),
};
vi.mock('../../../hooks/usePM5', () => ({ usePM5: () => pm5State }));
vi.mock('../../../StrengthLogger.jsx', () => ({
  default: () => <p>STRENGTH LOGGER</p>,
}));
vi.mock('../../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useAnchors.js', () => ({
  useAnchors: () => ({ cp: 240 }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MobileTrain from '../MobileTrain.jsx';
import {
  LIVE_ERG_FLAG_KEY,
  LIVE_ERG_FLAG_ON,
  LIVE_ERG_WORKOUT_KEY,
} from '../../../live-erg/liveErgFlag.js';

function renderTrain(props) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MobileTrain {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  pm5State = { ...pm5State, status: 'idle', metrics: null, error: null };
});
afterEach(() => window.localStorage.clear());

describe('Train: plan before connecting (#774)', () => {
  it('has no Plan a session entry while the v10 live screen is off', () => {
    renderTrain({ mode: null, onMode: () => {} });
    expect(screen.getByRole('button', { name: /Erg session/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Plan a session/ })).toBeNull();
  });

  it('offers it once the live screen is on, next to Erg, and it opens the planner', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    const onMode = vi.fn();
    renderTrain({ mode: null, onMode });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => /session/i.test(t));
    expect(labels[0]).toMatch(/Erg session/);
    expect(labels[1]).toMatch(/Plan a session/);
    expect(labels[2]).toMatch(/Strength session/);
    await user.click(screen.getByRole('button', { name: /Plan a session/ }));
    expect(onMode).toHaveBeenCalledWith('plan');
  });

  it('plan mode shows the builder with Connect to PM5, and Start opens the live screen once connected', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    const onMode = vi.fn();
    const { unmount } = renderTrain({ mode: 'plan', onMode });
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Connect to PM5' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByText('C2 CONNECT')).toBeNull();

    await user.click(
      screen.getAllByRole('button', { name: 'Remove interval' })[0]
    );
    expect(
      JSON.parse(window.localStorage.getItem(LIVE_ERG_WORKOUT_KEY))
    ).toMatchObject({
      type: 'int',
    });
    unmount();

    pm5State = { ...pm5State, status: 'connected' };
    renderTrain({ mode: 'plan', onMode });
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByTestId('live-erg-session')).toBeVisible();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
    expect(onMode).not.toHaveBeenCalled();
  });
});
