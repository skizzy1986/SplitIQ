import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }) },
}));
vi.mock('../MobileToday.jsx', () => ({
  default: ({ onStartSession }) => (
    <>
      <p>TODAY</p>
      <button type="button" onClick={() => onStartSession('tweak')}>
        Tweak
      </button>
      <button type="button" onClick={() => onStartSession('planned')}>
        Start
      </button>
    </>
  ),
}));
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
vi.mock('../../../hooks/usePM5', () => ({
  usePM5: () => ({
    status: 'idle',
    metrics: null,
    summary: null,
    error: null,
    errorCode: null,
    connect: () => {},
    reset: () => {},
    finish: () => {},
    disconnect: () => {},
    monitors: [],
    scanPhase: 'searching',
    connectingId: null,
    locationOff: false,
    choose: () => {},
    retryScan: () => {},
    cancelScan: () => {},
  }),
}));
vi.mock('../../../StrengthLogger.jsx', () => ({
  default: () => <p>LOGGER</p>,
}));
vi.mock('../MobileProgress.jsx', () => ({ default: () => <p>PROGRESS</p> }));
vi.mock('../MobileRecovery.jsx', () => ({ default: () => <p>BODY</p> }));
vi.mock('../MobileSettings.jsx', () => ({ default: () => <p>SETTINGS</p> }));
vi.mock('../../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useAnchors.js', () => ({
  useAnchors: () => ({ cp: 240 }),
}));

import MobileApp from '../MobileApp.jsx';
import {
  LIVE_ERG_FLAG_KEY,
  LIVE_ERG_FLAG_ON,
} from '../../../live-erg/liveErgFlag.js';

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MobileApp />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});
afterEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});

describe('Today → Tweak (#774)', () => {
  it('opens the planner with no PM5 when the v10 live screen is on', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Tweak' }));
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Connect to PM5' })
    ).toBeVisible();
    expect(screen.queryByText('C2 CONNECT')).toBeNull();
  });

  it('lands on the Train list, as before, when the live screen is off', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Tweak' }));
    expect(screen.getByRole('button', { name: /Erg session/ })).toBeVisible();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
    expect(screen.queryByRole('button', { name: /Plan a session/ })).toBeNull();
  });

  it('Back from a Today-opened planner returns to Today', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Tweak' }));
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(screen.getByText('TODAY')).toBeVisible();
    expect(screen.queryByTestId('live-erg-planner')).toBeNull();
    expect(screen.queryByRole('button', { name: /Erg session/ })).toBeNull();
  });

  it('Start on PM5 from Today also opens the planner, not the standalone connect page', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Connect to PM5' })
    ).toBeVisible();
    expect(screen.queryByText('C2 CONNECT')).toBeNull();
  });
});
