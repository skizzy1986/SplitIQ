import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Retro Gate 3 (#811, RC 3): "a new empty account reaches every tab with no
// crash" (#797) had no test. This renders the real mobile shell and the real
// views and hooks on a testers build, against a database that answers every
// read with no rows, and visits every tab and every Progress pane.
//
// Only the live erg screen and the strength logger are stubbed: they are full
// screens opened from Train, not tabs, and need Bluetooth or a workout.

const mocks = vi.hoisted(() => ({ errors: [] }));

vi.mock('../utils/testersBuild.js', () => ({ isTestersBuild: () => true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));
vi.mock('../utils/sentry.js', () => ({
  captureError: (e) => mocks.errors.push(e),
}));
vi.mock('../views/ErgLiveView.jsx', () => ({ default: () => null }));
vi.mock('../StrengthLogger.jsx', () => ({ default: () => null }));
vi.mock('recharts', () => {
  const Pass = ({ children }) => <div>{children}</div>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Pass,
    LineChart: Pass,
    BarChart: Pass,
    ComposedChart: Pass,
    Line: Nothing,
    Bar: Nothing,
    ReferenceLine: Nothing,
    ReferenceArea: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    Tooltip: Nothing,
  };
});

// An empty account: every query resolves with no rows and no error.
vi.mock('../supabaseClient.js', () => {
  const empty = { data: [], error: null, count: 0 };
  const none = { data: null, error: null };
  const builder = () => {
    const b = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'then')
            return (ok, bad) => Promise.resolve(empty).then(ok, bad);
          if (key === 'maybeSingle' || key === 'single')
            return () => Promise.resolve(none);
          return () => b;
        },
      }
    );
    return b;
  };
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const session = { user, access_token: 'test' };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => builder(),
      channel: () => {
        const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} };
        return c;
      },
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve(none) },
      auth: {
        getSession: () => Promise.resolve({ data: { session } }),
        getUser: () => Promise.resolve({ data: { user } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    },
  };
});

import MobileApp from '../views/mobile/MobileApp.jsx';

const errorsOnScreen = () =>
  screen.queryByText(/something went wrong|error boundary/i);

beforeEach(() => {
  mocks.errors.length = 0;
  window.location.hash = '';
  localStorage.clear();
});

describe('a new, empty tester account', () => {
  it('reaches every tab and every Progress pane with no crash', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const consoleError = vi.spyOn(console, 'error');
    render(
      <QueryClientProvider client={queryClient}>
        <MobileApp />
      </QueryClientProvider>
    );
    const tab = (name) =>
      screen.getByRole('button', { name: new RegExp(`^${name}`) });

    // Each tab, and the empty state it should land on.
    const tabs = [
      ['Today', 'No sessions logged yet.'],
      ['Train', 'START A SESSION'],
      ['Progress', 'No upcoming sessions'],
      ['Body', 'No vitals recorded yet'],
    ];
    for (const [name, empty] of tabs) {
      await user.click(tab(name));
      await act(async () => {
        await queryClient.refetchQueries();
      });
      expect(errorsOnScreen()).toBeNull();
      expect(await screen.findByText(empty)).toBeInTheDocument();
    }

    await user.click(tab('Progress'));
    const panes = [
      ['Load', 'No upcoming sessions'],
      ['Erg', 'PERFORMANCE SUMMARY'],
      ['Strength', /No strength PRs yet/],
      ['History', 'No sessions found'],
    ];
    for (const [pane, empty] of panes) {
      await user.click(screen.getByRole('button', { name: pane }));
      await act(async () => {
        await queryClient.refetchQueries();
      });
      expect(errorsOnScreen()).toBeNull();
      expect(await screen.findByText(empty)).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Theme')).toBeInTheDocument();

    await waitFor(() => expect(mocks.errors).toEqual([]));
    const reactCrashes = consoleError.mock.calls.filter(([m]) =>
      /The above error occurred|Uncaught|error boundary/i.test(String(m))
    );
    expect(reactCrashes).toEqual([]);
    consoleError.mockRestore();
  });
});
