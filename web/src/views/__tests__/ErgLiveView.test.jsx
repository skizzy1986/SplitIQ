import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mocks for supabase + the two hooks ErgLiveView depends on.
const insertMock = vi.fn();
const getUserMock = vi.fn();
const addToQueueMock = vi.fn();
const resetMock = vi.fn();
const finishMock = vi.fn();
const disconnectMock = vi.fn();

let pm5State;
let queueState;

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: { getUser: (...args) => getUserMock(...args) },
    from: () => ({ insert: (...args) => insertMock(...args) }),
  },
}));

vi.mock('../../hooks/usePM5', () => ({
  usePM5: () => pm5State,
}));

vi.mock('../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => queueState,
}));

import ErgLiveView from '../ErgLiveView.jsx';
import { SessionOwnerContext } from '../../hooks/useSessionOwner.js';
import { startPrivateSession } from '../../utils/privateSessionState.js';

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

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithClient(ui, client, owner = 'user-123') {
  return render(
    <QueryClientProvider client={client}>
      <SessionOwnerContext.Provider value={owner}>
        {ui}
      </SessionOwnerContext.Provider>
    </QueryClientProvider>
  );
}

function finished(extra = {}) {
  pm5State = { ...pm5State, status: 'finished', summary: SUMMARY, ...extra };
}

async function save() {
  fireEvent.click(screen.getByText('SAVE SESSION'));
  await waitFor(() =>
    expect(
      insertMock.mock.calls.length + addToQueueMock.mock.calls.length
    ).toBeGreaterThan(0)
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 18, 7, 15));
  insertMock.mockReset();
  getUserMock.mockReset();
  addToQueueMock.mockReset();
  resetMock.mockReset();
  finishMock.mockReset();
  disconnectMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
  insertMock.mockResolvedValue({ error: null });
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  pm5State = {
    status: 'idle',
    metrics: null,
    summary: null,
    error: null,
    connect: vi.fn(),
    reset: resetMock,
    finish: finishMock,
    disconnect: disconnectMock,
  };
  queueState = { addToQueue: addToQueueMock, pending: 0 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ErgLiveView', () => {
  it('renders the connect screen when idle', () => {
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByText('C2 CONNECT')).toBeInTheDocument();
    expect(screen.getByText('CONNECT TO PM5')).toBeInTheDocument();
  });

  it('renders the summary screen when a session is finished', () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByText('SESSION COMPLETE')).toBeInTheDocument();
    expect(screen.getByText('SAVE SESSION')).toBeInTheDocument();
  });

  it('shows the pending-sync count on the connect screen', () => {
    queueState = { ...queueState, pending: 3 };
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByText('3 PENDING SYNC')).toBeInTheDocument();
  });

  it('tolerates a queue hook that reports no pending count', () => {
    queueState = { addToQueue: addToQueueMock };
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.queryByText(/PENDING SYNC/)).not.toBeInTheDocument();
  });

  it('rounds the live distance, which the PM5 reports to 0.1 m', () => {
    pm5State = {
      ...pm5State,
      status: 'rowing',
      metrics: { distance: 2500.6, elapsedStr: '10:00' },
    };
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByText('2501')).toBeInTheDocument();
    expect(screen.queryByText('2500.6')).not.toBeInTheDocument();
  });
});

describe('ErgLiveView save row', () => {
  it('inserts exactly the columns the sessions table has', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    const row = insertMock.mock.calls[0][0];
    expect(row).toEqual({
      date: '8/18/26',
      type: 'erg',
      label: 'Erg Session 07:15',
      duration: '20:00',
      srpe: 5,
      distance_m: 5000,
      avg_watts: 180,
      status: 'logged',
      source: 'bluetooth',
      exercises: [],
      user_id: 'user-123',
    });
    // Columns that do not exist on `sessions` must never be sent — the insert
    // is rejected wholesale if they are.
    expect(row).not.toHaveProperty('watts');
    expect(row).not.toHaveProperty('distance');
    // The PM5 General Status packet carries no heart rate.
    expect(row).not.toHaveProperty('avg_hr');
  });

  it('writes the date as unpadded M/D/YY text', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();
    expect(insertMock.mock.calls[0][0].date).toMatch(
      /^\d{1,2}\/\d{1,2}\/\d{2}$/
    );
  });

  it('writes duration as MM:SS text rather than a number of minutes', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();
    expect(insertMock.mock.calls[0][0].duration).toBe('20:00');
  });

  it('carries the notes through as an exercises entry', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    fireEvent.change(screen.getByPlaceholderText(/How did it feel/), {
      target: { value: 'legs felt good' },
    });
    await save();
    expect(insertMock.mock.calls[0][0].exercises).toEqual([
      { name: 'Notes', notes: 'legs felt good' },
    ]);
  });

  it('nulls unmeasured metrics instead of writing zeroes', async () => {
    pm5State = {
      ...pm5State,
      status: 'finished',
      summary: {
        distance: 0,
        elapsedTime: 0,
        elapsedStr: '00:00',
        avgWatts: 0,
        avgPace: 0,
        avgSpm: 0,
        maxWatts: 0,
        calories: 0,
      },
    };
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    const row = insertMock.mock.calls[0][0];
    expect(row.distance_m).toBeNull();
    expect(row.avg_watts).toBeNull();
    expect(row.duration).toBe('00:00');
    expect(row.exercises).toEqual([]);
    expect(row.user_id).toBe('user-123');
  });
});

describe('ErgLiveView sRPE buttons (#422)', () => {
  it('renders one button per point on the shared sRPE bands', () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    const buttons = screen.getAllByRole('button', { name: /^\d+ — / });
    expect(buttons).toHaveLength(10);
    expect(buttons.map((b) => b.textContent)).toEqual([
      '1 — Very easy',
      '2 — Very easy',
      '3 — Easy (UT2)',
      '4 — Easy (UT2)',
      '5 — Steady (UT1)',
      '6 — Steady (UT1)',
      '7 — Hard (threshold)',
      '8 — Hard (threshold)',
      '9 — Max',
      '10 — Max',
    ]);
  });

  it('saves the sRPE of the button that was clicked', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    fireEvent.click(screen.getByText('7 — Hard (threshold)'));
    await save();
    expect(insertMock.mock.calls[0][0].srpe).toBe(7);
  });
});

describe('ErgLiveView planned-session matching', () => {
  const planned = {
    date: '8/18/26',
    _isErg: true,
    type: 'Z2 Aerobic',
    label: 'UT1 Steady 50min',
    status: 'planned',
  };

  it("labels the row from today's planned erg session", async () => {
    finished();
    renderWithClient(<ErgLiveView plannedSessions={[planned]} />, makeClient());
    await save();
    expect(insertMock.mock.calls[0][0].label).toBe('UT1 Steady 50min 07:15');
  });

  it('ignores a planned session on another date', async () => {
    finished();
    renderWithClient(
      <ErgLiveView plannedSessions={[{ ...planned, date: '8/17/26' }]} />,
      makeClient()
    );
    await save();
    expect(insertMock.mock.calls[0][0].label).toBe('Erg Session 07:15');
  });

  it('ignores a planned session for another modality', async () => {
    finished();
    renderWithClient(
      <ErgLiveView
        plannedSessions={[{ ...planned, _isErg: false, _isCycling: true }]}
      />,
      makeClient()
    );
    await save();
    expect(insertMock.mock.calls[0][0].label).toBe('Erg Session 07:15');
  });

  it('gives two sessions on the same day distinct labels', async () => {
    finished();
    const first = renderWithClient(<ErgLiveView />, makeClient());
    await save();
    first.unmount();

    vi.setSystemTime(new Date(2026, 7, 18, 17, 40));
    renderWithClient(<ErgLiveView />, makeClient());
    await waitFor(() => expect(screen.getByText('SAVE SESSION')).toBeVisible());
    fireEvent.click(screen.getByText('SAVE SESSION'));
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));

    const [a, b] = insertMock.mock.calls.map(([row]) => row);
    expect(a.date).toBe(b.date);
    expect(a.label).not.toBe(b.label);
    expect(b.label).toBe('Erg Session 17:40');
  });
});

describe('ErgLiveView save outcomes', () => {
  it('reports success, refreshes the log queries and does not queue', async () => {
    finished();
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderWithClient(<ErgLiveView />, client);
    await save();

    await waitFor(() =>
      expect(screen.getByText('SAVED TO LOG')).toBeInTheDocument()
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['erg-sessions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tss-history'] });
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  it('queues the row and says so when the insert is rejected', async () => {
    insertMock.mockResolvedValue({
      error: { code: '42501', message: 'permission denied' },
    });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    expect(addToQueueMock).toHaveBeenCalledTimes(1);
    expect(addToQueueMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        date: '8/18/26',
        label: 'Erg Session 07:15',
        duration: '20:00',
        distance_m: 5000,
        avg_watts: 180,
        status: 'logged',
      })
    );
    await waitFor(() =>
      expect(screen.getByText('SAVED LOCALLY — WILL SYNC')).toBeInTheDocument()
    );
    expect(screen.queryByText('SAVED TO LOG')).not.toBeInTheDocument();
  });

  it('queues without attempting an insert when offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    expect(addToQueueMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('SAVED LOCALLY — WILL SYNC')).toBeInTheDocument()
    );
  });

  it('treats a duplicate-key rejection as saved rather than queueing it', async () => {
    insertMock.mockResolvedValue({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    expect(addToQueueMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('SAVED TO LOG')).toBeInTheDocument()
    );
  });

  it('queues when the auth lookup itself rejects', async () => {
    getUserMock.mockRejectedValue(new Error('no session'));
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    expect(insertMock).not.toHaveBeenCalled();
    expect(addToQueueMock).toHaveBeenCalledTimes(1);
    expect(addToQueueMock.mock.calls[0][0].user_id).toBe('user-123');
  });

  it('surfaces a failure when the row cannot even be stored locally', async () => {
    insertMock.mockResolvedValue({ error: { code: '42501', message: 'nope' } });
    addToQueueMock.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    await waitFor(() =>
      expect(screen.getByText(/SAVE FAILED/)).toBeInTheDocument()
    );
    expect(screen.queryByText('SAVED TO LOG')).not.toBeInTheDocument();
    expect(
      screen.queryByText('SAVED LOCALLY — WILL SYNC')
    ).not.toBeInTheDocument();
    // The session is still on screen, so the data is not lost — retry is possible.
    expect(screen.getByText('SAVE SESSION')).toBeInTheDocument();
  });
});

describe('ErgLiveView post-save flow', () => {
  it('keeps the summary on screen until DONE is pressed', async () => {
    finished();
    const onSessionSaved = vi.fn();
    renderWithClient(
      <ErgLiveView onSessionSaved={onSessionSaved} />,
      makeClient()
    );
    await save();

    await waitFor(() =>
      expect(screen.getByText('SAVED TO LOG')).toBeInTheDocument()
    );
    expect(resetMock).not.toHaveBeenCalled();
    expect(onSessionSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('DONE'));
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(onSessionSaved).toHaveBeenCalledTimes(1);
  });

  it('offers DONE after a queued save too', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();

    await waitFor(() => expect(screen.getByText('DONE')).toBeInTheDocument());
    expect(screen.queryByText('SAVE SESSION')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('DONE'));
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});

describe('ErgLiveView manual end', () => {
  it('routes END into the summary screen instead of discarding the session', () => {
    pm5State = {
      ...pm5State,
      status: 'rowing',
      metrics: {
        watts: 180,
        strokeRate: 24,
        distance: 5000,
        elapsedStr: '20:00',
      },
    };
    const { rerender } = renderWithClient(<ErgLiveView />, makeClient());

    fireEvent.click(screen.getByText('END'));
    expect(finishMock).toHaveBeenCalledTimes(1);
    expect(resetMock).not.toHaveBeenCalled();

    // usePM5.finish() flips status to 'finished' with a summary.
    finished();
    const client = makeClient();
    rerender(
      <QueryClientProvider client={client}>
        <ErgLiveView />
      </QueryClientProvider>
    );
    expect(screen.getByText('SESSION COMPLETE')).toBeInTheDocument();
  });

  it('saves a manually-ended session through the same flow', async () => {
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    await save();
    await waitFor(() =>
      expect(screen.getByText('SAVED TO LOG')).toBeInTheDocument()
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe('live save account isolation', () => {
  it('abandons a deferred auth lookup when the account changes before it resolves', async () => {
    let release;
    getUserMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    fireEvent.click(screen.getByText('SAVE SESSION'));
    await waitFor(() => expect(getUserMock).toHaveBeenCalled());
    startPrivateSession();
    await act(async () => {
      release({ data: { user: { id: 'account-B' } } });
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  it('never restores an old row to the queue after a deferred insert fails on another account', async () => {
    let release;
    insertMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    fireEvent.click(screen.getByText('SAVE SESSION'));
    await waitFor(() => expect(insertMock).toHaveBeenCalled());
    startPrivateSession();
    await act(async () => {
      release({ error: { code: '42501', message: 'changed account' } });
    });
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  it('refuses a different auth identity even before its auth event is delivered', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'account-B' } } });
    finished();
    renderWithClient(<ErgLiveView />, makeClient());
    fireEvent.click(screen.getByText('SAVE SESSION'));
    await act(async () => {});
    expect(insertMock).not.toHaveBeenCalled();
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  it('does not invent an owner when both context and auth identity are absent', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    finished();
    renderWithClient(<ErgLiveView />, makeClient(), null);
    fireEvent.click(screen.getByText('SAVE SESSION'));
    await waitFor(() =>
      expect(screen.getByText(/SAVE FAILED/)).toBeInTheDocument()
    );
    expect(insertMock).not.toHaveBeenCalled();
    expect(addToQueueMock).not.toHaveBeenCalled();
  });
});

describe('ErgLiveView way out (phone)', () => {
  const backButton = () =>
    screen.getByRole('button', { name: 'Back to Train' });

  it('shows no way out where the host gives none (desktop)', () => {
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.queryByRole('button', { name: 'Back to Train' })).toBeNull();
  });

  it('leaves the connect screen at once', () => {
    const onExit = vi.fn();
    renderWithClient(<ErgLiveView onExit={onExit} />, makeClient());
    expect(screen.getByText('C2 CONNECT')).toBeInTheDocument();
    fireEvent.click(backButton());
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('asks before leaving mid-piece, and Stay keeps the piece', () => {
    pm5State = {
      ...pm5State,
      status: 'rowing',
      metrics: {
        watts: 180,
        strokeRate: 24,
        distance: 900,
        elapsedStr: '4:00',
      },
    };
    const onExit = vi.fn();
    renderWithClient(<ErgLiveView onExit={onExit} />, makeClient());
    fireEvent.click(backButton());
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'The PM5 disconnects and this piece is not saved.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(screen.getByText('END')).toBeInTheDocument();
  });

  it('disconnects and leaves when Leave is confirmed', () => {
    pm5State = { ...pm5State, status: 'connected' };
    const onExit = vi.fn();
    renderWithClient(<ErgLiveView onExit={onExit} />, makeClient());
    fireEvent.click(backButton());
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('asks before leaving an unsaved summary', () => {
    finished();
    const onExit = vi.fn();
    renderWithClient(<ErgLiveView onExit={onExit} />, makeClient());
    fireEvent.click(backButton());
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Leave without saving this piece?'
    );
    expect(onExit).not.toHaveBeenCalled();
  });

  it('leaves a saved summary without asking', async () => {
    finished();
    const onExit = vi.fn();
    renderWithClient(<ErgLiveView onExit={onExit} />, makeClient());
    await save();
    await screen.findByText(/DONE/);
    fireEvent.click(backButton());
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

// #696: on Android, Connect opens a list of PM5s in range.
describe('ErgLiveView and the Android PM5 list', () => {
  function choosing(extra = {}) {
    pm5State = {
      ...pm5State,
      status: 'choosing',
      monitors: [
        { id: 'AA', name: 'PM5 431719123 Row' },
        { id: 'BB', name: null },
      ],
      scanPhase: 'searching',
      connectingId: null,
      locationOff: false,
      errorCode: null,
      choose: vi.fn(),
      retryScan: vi.fn(),
      cancelScan: vi.fn(),
      ...extra,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the list, not the live screen, while choosing', () => {
    choosing();
    renderWithClient(<ErgLiveView />, makeClient());
    expect(
      screen.getByRole('heading', { name: 'Choose your PM5' })
    ).toBeInTheDocument();
    expect(screen.queryByText('END')).not.toBeInTheDocument();
    expect(screen.queryByText('CONNECTED')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PM5 431719123 Row' }));
    expect(pm5State.choose).toHaveBeenCalledWith('AA');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(pm5State.cancelScan).toHaveBeenCalledTimes(1);
  });

  it('hands the empty state and its retry to the list', () => {
    choosing({ monitors: [], scanPhase: 'empty', locationOff: true });
    renderWithClient(<ErgLiveView />, makeClient());
    expect(
      screen.getByText(/Location must be on to find a PM5/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(pm5State.retryScan).toHaveBeenCalledTimes(1);
  });

  it('shows a failed connect on the list', () => {
    choosing({ errorCode: 'PM5_CONNECT_FAILED' });
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't connect to that PM5."
    );
  });

  // AC7: the browser copy is unchanged.
  it('keeps the browser chooser copy in the browser', () => {
    const { container } = renderWithClient(<ErgLiveView />, makeClient());
    expect(container.textContent).toContain('Tap Connect — your browser will');
    expect(container.textContent).not.toContain('from the list');
  });

  it('tells the Android app to choose from the list', async () => {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const { container } = renderWithClient(<ErgLiveView />, makeClient());
    expect(container.textContent).toContain('Tap Connect, then choose your');
    expect(container.textContent).toContain('monitor from the list.');
    expect(container.textContent).not.toContain('your browser will');
  });

  it.each([
    [
      'PM5_BLE_UNAVAILABLE',
      "This phone can't use Bluetooth Low Energy, so it can't connect to a PM5.",
    ],
    [
      'PM5_SCAN_FAILED',
      "Couldn't start searching for PM5s. Tap Connect to try again.",
    ],
    [
      'PM5_BLUETOOTH_OFF',
      "Bluetooth is off. Turn it on in your phone's settings, then tap Connect again.",
    ],
    [
      'PM5_PERMISSION_DENIED',
      "SplitIQ can't use Bluetooth. In Settings › Apps › SplitIQ › Permissions, allow Nearby devices (Location on Android 11 and older), then tap Connect again.",
    ],
  ])('shows %s in its own words on the Connect screen', (code, words) => {
    pm5State = {
      ...pm5State,
      status: 'error',
      error: 'English for the logs',
      errorCode: code,
    };
    renderWithClient(<ErgLiveView />, makeClient());
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.queryByText('English for the logs')).not.toBeInTheDocument();
  });
});
