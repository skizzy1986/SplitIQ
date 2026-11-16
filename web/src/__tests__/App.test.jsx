import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

// Representative raw rows exercise the shared selector and desktop prop wiring.
const rows = [
  {
    id: 'erg-1',
    date: '7/9/26',
    type: 'erg',
    label: 'UT2 60min',
    duration: 3600,
    srpe: 4,
    prs: null,
    exercises: null,
    coach_note: 'steady',
    status: 'logged',
    distance_m: 12000,
    avg_watts: 150,
    avg_hr: 132,
  },
  {
    id: 'str-1',
    date: '7/8/26',
    type: 'strength',
    label: 'Upper A',
    duration: 2400,
    srpe: 6,
    prs: 'Bench PR',
    exercises: [{ name: 'Bench Press' }],
    coach_note: null,
    status: 'completed',
    distance_m: null,
    avg_watts: null,
    avg_hr: null,
  },
  {
    id: 'cyc-1',
    date: '7/12/26',
    type: 'cycling',
    label: 'Z2 ride',
    duration: 5400,
    srpe: null,
    prs: null,
    exercises: null,
    coach_note: null,
    status: 'planned',
    distance_m: null,
    avg_watts: null,
    avg_hr: null,
  },
  {
    id: 'cancel-1',
    date: '7/5/26',
    type: 'erg',
    label: 'CP RETEST — 1min + 4min max (rested, fed)',
    duration: 1800,
    srpe: null,
    prs: null,
    exercises: null,
    coach_note: null,
    status: 'cancelled',
    distance_m: null,
    avg_watts: null,
    avg_hr: null,
  },
  {
    id: 'test-1',
    date: '7/1/26',
    type: 'Test',
    label: 'CP test',
    duration: 600,
    srpe: null,
    prs: null,
    exercises: null,
    coach_note: null,
    status: 'completed',
    distance_m: null,
    avg_watts: null,
    avg_hr: null,
  },
];

const refetchMock = vi.fn();
vi.mock('../hooks/useSessions.js', () => ({
  useSessions: () => ({
    data: rows,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  }),
}));

// Stub every child module App imports so the test drives App's own routing and
// mapping logic in isolation (utils + constants run for real).
vi.mock('../StrengthLogger.jsx', () => ({
  default: function Logger() {
    const [count, setCount] = useState(0);
    return (
      <div>
        StrengthLogger-stub
        <button onClick={() => setCount(count + 1)}>Sets {count}</button>
      </div>
    );
  },
}));
vi.mock('../views/ErgLiveView.jsx', () => ({
  default: function Live({ onSessionSaved }) {
    const [watts, setWatts] = useState(100);
    return (
      <div>
        ErgLiveView-stub
        <button onClick={() => setWatts(watts + 1)}>Watts {watts}</button>
        <button onClick={onSessionSaved}>Save erg</button>
      </div>
    );
  },
}));
vi.mock('../views/mobile/MobileAnalytics.jsx', () => ({
  default: () => <div>LoadView-stub</div>,
}));
// Flipped by the error-boundary test so one tab's render throws on demand.
let settingsThrows = false;
vi.mock('../views/SettingsView.jsx', () => ({
  default: () => {
    if (settingsThrows) throw new Error('settings blew up');
    return <div>SettingsView-stub</div>;
  },
}));
vi.mock('../views/ErgView.jsx', () => ({
  default: () => <div>ErgView-stub</div>,
}));

const captureErrorMock = vi.fn();
vi.mock('../utils/sentry.js', () => ({
  captureError: (...args) => captureErrorMock(...args),
}));
vi.mock('../views/RecoveryView.jsx', () => ({
  default: () => <div>RecoveryView-stub</div>,
}));
vi.mock('../views/StrengthView.jsx', () => ({
  default: () => <div>StrengthView-stub</div>,
}));
vi.mock('../views/MobilityView.jsx', () => ({
  default: () => <div>MobilityView-stub</div>,
}));
// Surfaces the load props so a test can assert what App derived and passed
// down, rather than reaching into OverviewView's own rendering.
vi.mock('../views/OverviewView.jsx', () => ({
  default: ({
    latest,
    loadUnavailable,
    totalErgDist,
    ftp,
    loggedSessions,
    totalSessions,
  }) => (
    <div>
      OverviewView-stub
      <span data-testid="ctl">{latest ? latest.ctl : 'none'}</span>
      <span data-testid="tsb">{latest ? latest.tsb : 'none'}</span>
      <span data-testid="unavailable">{String(loadUnavailable)}</span>
      <span data-testid="ergdist">{String(totalErgDist)}</span>
      <span data-testid="ftp">{String(ftp)}</span>
      <span data-testid="overview-counted">{loggedSessions?.length}</span>
      <span data-testid="overview-total">{totalSessions}</span>
    </div>
  ),
}));
vi.mock('../views/CalendarView.jsx', () => ({
  default: (props) => (
    <div>
      <div>CalendarView-stub</div>
      <div data-testid="calendar-counted">{props.loggedSessions?.length}</div>
      <div data-testid="calendar-cancelled">
        {props.cancelledSessions?.length}
      </div>
    </div>
  ),
}));
vi.mock('../views/PlanView.jsx', () => ({
  default: () => <div>PlanView-stub</div>,
}));
vi.mock('../views/LogView.jsx', () => ({
  default: (props) => (
    <div>
      <div>LogView-stub</div>
      <div data-testid="logview-shown">{props.logDisplaySessions?.length}</div>
    </div>
  ),
}));

// App reads CTL/ATL/TSB through useTSSHistory (react-query + supabase). Mock it
// so these tests stay about App's own wiring, and so each case can choose
// between a live series, an empty read, and a still-pending one.
const tssHistoryMock = vi.fn();
vi.mock('../hooks/useTSSHistory.js', () => ({
  useTSSHistory: () => tssHistoryMock(),
}));

import App from '../App.jsx';
import { version } from '../../package.json';

// Two sessions on consecutive days, in classic TSS units.
const LIVE_TSS = [
  { date: '8/5/26', tss: 55 },
  { date: '8/6/26', tss: 70 },
];

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  refetchMock.mockReset();
  settingsThrows = false;
  captureErrorMock.mockReset();
  tssHistoryMock.mockReset();
  tssHistoryMock.mockReturnValue({
    data: LIVE_TSS,
    isLoading: false,
    isError: false,
  });
});

const NAV = [
  ['Today', 'Overview', 'OverviewView-stub'],
  ['Today', 'Calendar', 'CalendarView-stub'],
  ['Train', 'Plan', 'PlanView-stub'],
  ['Train', 'Live', 'ErgLiveView-stub'],
  ['Train', 'Logger', 'StrengthLogger-stub'],
  ['Train', 'Mobility', 'MobilityView-stub'],
  ['Progress', 'Load', 'LoadView-stub'],
  ['Progress', 'Erg', 'ErgView-stub'],
  ['Progress', 'Strength', 'StrengthView-stub'],
  ['Progress', 'History', 'LogView-stub'],
  ['Body', null, 'RecoveryView-stub'],
  ['Settings', null, 'SettingsView-stub'],
];

function press(label) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
}
async function hashTo(hash) {
  await act(async () => {
    window.history.replaceState(null, '', `/${hash}`);
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  });
}

describe('App', () => {
  it('renders the header, full nav, and routes every tab to its view', async () => {
    render(<App />);

    // Wait for the async fetch to settle so the row mapping runs inside act().
    expect(await screen.findByText('OverviewView-stub')).toBeInTheDocument();

    expect(screen.getByText('SPLITIQ')).toBeInTheDocument();

    // The header carries package.json's version, not a hardcoded label (R34),
    // and no longer the one-athlete phase eyebrow (R35).
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(screen.getByText('v' + version)).toBeInTheDocument();
    expect(screen.queryByText(/STRENGTH · BASE/)).toBeNull();
    expect(screen.queryByText(/beta/)).toBeNull();

    const primary = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(primary)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Today', 'Train', 'Progress', 'Body', 'Settings']);
    expect(screen.queryByRole('button', { name: 'COACH' })).toBeNull();
    for (const [destination, pane, marker] of NAV) {
      press(destination);
      if (pane) press(pane);
      expect(await screen.findByText(marker)).toBeInTheDocument();
    }
  }, 30000);

  it('derives CTL/ATL/TSB from the live session history, not a static seed', async () => {
    render(<App />);
    await screen.findByText('OverviewView-stub');

    // calcTrainingLoad walks day-by-day to today and decays, so the exact value
    // moves with the clock. What matters is that a real series produced a real
    // reading and the view was not told the data is unavailable.
    expect(screen.getByTestId('ctl').textContent).not.toBe('none');
    expect(Number(screen.getByTestId('ctl').textContent)).toBeGreaterThan(0);
    expect(screen.getByTestId('unavailable').textContent).toBe('false');
  }, 30000);

  it('says the load is unavailable rather than rendering a fabricated zero', async () => {
    tssHistoryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
    });
    render(<App />);
    await screen.findByText('OverviewView-stub');

    expect(screen.getByTestId('ctl').textContent).toBe('none');
    expect(screen.getByTestId('tsb').textContent).toBe('none');
    expect(screen.getByTestId('unavailable').textContent).toBe('true');
  }, 30000);

  it('treats a still-pending first read as pending, not unavailable', async () => {
    // A slow read must not flash an outage line and then replace it with real
    // numbers (#196) — no reading yet, but nothing is claimed to be broken.
    tssHistoryMock.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
    });
    render(<App />);
    await screen.findByText('OverviewView-stub');

    expect(screen.getByTestId('ctl').textContent).toBe('none');
    expect(screen.getByTestId('unavailable').textContent).toBe('false');
  }, 30000);

  it('sums erg distance from the logged sessions instead of a hardcoded total', async () => {
    // The fixture carries one erg row at 12000m. This was `55000` regardless of
    // what had actually been logged.
    render(<App />);
    await screen.findByText('OverviewView-stub');
    expect(screen.getByTestId('ergdist').textContent).toBe('12000');
  }, 30000);

  it('no longer threads a hardcoded ftp down to the overview', async () => {
    // CP/FTP now come from the live anchors inside OverviewView.
    render(<App />);
    await screen.findByText('OverviewView-stub');
    expect(screen.getByTestId('ftp').textContent).toBe('undefined');
  }, 30000);

  it('R9 wires the shown list to LogView and the counted list to every counting consumer (#194)', async () => {
    // The regression this guards is a prop swap, not a filter bug: the hook can
    // be perfectly correct while App hands the wrong list to the wrong view.
    // Fixture: erg-1 logged + str-1 completed = 2 counted; + cancel-1 = 3 shown;
    // cyc-1 planned and test-1 (type 'Test') are excluded from both.
    render(<App />);
    await screen.findByText('OverviewView-stub');

    expect(screen.getByTestId('overview-counted')).toHaveTextContent('2');
    expect(screen.getByTestId('overview-total')).toHaveTextContent('2');

    press('Calendar');
    expect(await screen.findByTestId('calendar-counted')).toHaveTextContent(
      '2'
    );
    expect(screen.getByTestId('calendar-cancelled')).toHaveTextContent('1');

    press('Progress');
    press('History');
    expect(await screen.findByTestId('logview-shown')).toHaveTextContent('3');
  }, 30000);

  // The boundary isolates a broken tab, which is right — but it used to do so
  // silently, so no render error in any tab ever reached Sentry.
  it('reports a tab render error to Sentry while isolating it', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    render(<App />);
    await screen.findByText('OverviewView-stub');

    settingsThrows = true;
    press('Settings');

    // The throw now happens on the far side of a Suspense boundary. The
    // ErrorBoundary sits OUTSIDE that Suspense precisely so it still
    // catches this and still reports it.
    expect(await screen.findByText(/isolated to protect/i)).toBeInTheDocument();
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [error, context] = captureErrorMock.mock.calls[0];
    expect(error.message).toBe('settings blew up');
    expect(context.componentStack).toEqual(expect.any(String));

    consoleError.mockRestore();
  }, 30000);

  it('updates the responsive layout on window resize', async () => {
    render(<App />);
    await screen.findByText('OverviewView-stub');

    window.innerWidth = 500;
    fireEvent(window, new window.Event('resize'));

    expect(screen.getByText('SPLITIQ')).toBeInTheDocument();
  }, 30000);
  it('reloads a linked pane and follows external Back/Forward hash changes', async () => {
    window.history.replaceState(null, '', '/#/progress/strength');
    render(<App />);
    await screen.findByText('StrengthView-stub');
    expect(screen.getByRole('button', { name: 'Progress' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await hashTo('#/today/calendar');
    await screen.findByText('CalendarView-stub');
    await hashTo('#/progress/strength');
    await screen.findByText('StrengthView-stub');
    expect(screen.getByRole('button', { name: 'Strength' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('renders the sidebar foot inside the sidebar, after the navigation', () => {
    render(<App sidebarFoot={<button type="button">Sign out</button>} />);
    const sidebar = screen.getByRole('complementary');
    const signOut = within(sidebar).getByRole('button', { name: 'Sign out' });
    const nav = within(sidebar).getByRole('navigation', {
      name: 'Main navigation',
    });
    // 0x04 is DOCUMENT_POSITION_FOLLOWING: sign-out comes after the nav.
    expect(nav.compareDocumentPosition(signOut) & 0x04).toBeTruthy();
    expect(signOut.style.position).toBe('');
  });

  it('returns from Settings to the exact prior pane and restores Settings focus', async () => {
    render(<App />);
    await screen.findByText('OverviewView-stub');
    press('Calendar');
    await screen.findByText('CalendarView-stub');
    press('Settings');
    await screen.findByText('SettingsView-stub');
    expect(window.location.hash).toBe('#/settings');
    press('Back');
    await screen.findByText('CalendarView-stub');
    expect(window.location.hash).toBe('#/today/calendar');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('preserves started logger and live state while visiting other destinations', async () => {
    render(<App />);
    await screen.findByText('OverviewView-stub');
    expect(screen.queryByText('StrengthLogger-stub')).toBeNull();
    expect(screen.queryByText('ErgLiveView-stub')).toBeNull();
    press('Train');
    press('Logger');
    await screen.findByText('StrengthLogger-stub');
    press('Sets 0');
    press('Body');
    await screen.findByText('RecoveryView-stub');
    expect(screen.getByText('StrengthLogger-stub')).not.toBeVisible();
    press('Train');
    press('Logger');
    expect(screen.getByRole('button', { name: 'Sets 1' })).toBeVisible();
    press('Live');
    await screen.findByText('ErgLiveView-stub');
    press('Watts 100');
    press('Settings');
    await screen.findByText('SettingsView-stub');
    press('Back');
    expect(screen.getByRole('button', { name: 'Watts 101' })).toBeVisible();
    press('Save erg');
    await screen.findByText('LogView-stub');
    expect(window.location.hash).toBe('#/progress/history');
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes legacy and unknown links without adding phantom history', async () => {
    window.history.replaceState(null, '', '/#/log');
    render(<App />);
    await screen.findByText('LogView-stub');
    expect(window.location.hash).toBe('#/progress/history');
    await hashTo('#/missing');
    await screen.findByText('OverviewView-stub');
    expect(window.location.hash).toBe('#/today');
  });
});
