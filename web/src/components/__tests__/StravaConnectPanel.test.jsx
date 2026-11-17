import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const connectionMock = vi.fn();
const startMutate = vi.fn();
const syncMutate = vi.fn();
const syncFactory = vi.fn();
const previewMutate = vi.fn();
const previewReset = vi.fn();
const disconnectMutate = vi.fn();
const disconnectReset = vi.fn();

// Mutable mutation state: a test sets these, then rerenders, the way react-query
// would re-render the panel as a mutation moves through its states.
let previewState;
let disconnectState;
const idle = () => ({
  isPending: false,
  isError: false,
  isSuccess: false,
  data: undefined,
});

vi.mock('../../hooks/useStravaConnection.js', () => ({
  useStravaConnection: () => connectionMock(),
}));
vi.mock('../../hooks/useStravaConnect.js', () => ({
  useStravaConnect: () => ({
    start: { mutate: startMutate, isPending: false, isError: false },
    preview: { ...previewState, mutate: previewMutate, reset: previewReset },
    disconnect: {
      ...disconnectState,
      mutate: disconnectMutate,
      reset: disconnectReset,
    },
  }),
}));
vi.mock('../../hooks/useStravaSync.js', () => ({
  useStravaSync: (opts) => {
    syncFactory(opts);
    return { mutate: syncMutate, isPending: false, isError: false };
  },
}));

import StravaConnectPanel from '../StravaConnectPanel.jsx';
import { describeConnection } from '../../utils/stravaStatus.js';

// The panel is driven entirely by describeConnection's output, so the fixtures
// are real rows put through the real util — a wrong precedence in the util
// shows up here as the wrong buttons rather than passing on a hand-written stub.
function connected(over = {}) {
  return {
    connected: true,
    backfill_complete: true,
    last_run_at: new Date().toISOString(),
    last_run_status: 'ok',
    imported_total: 5,
    adopted_total: 0,
    failed_total: 0,
    ambiguous_activity_ids: [],
    ...over,
  };
}

function mockState(row, extra = {}) {
  connectionMock.mockReturnValue({
    connection: row,
    status: describeConnection(row, new Date()),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  });
}

beforeEach(() => {
  connectionMock.mockReset();
  startMutate.mockReset();
  syncMutate.mockReset();
  syncFactory.mockReset();
  previewMutate.mockReset();
  previewReset.mockReset();
  disconnectMutate.mockReset();
  disconnectReset.mockReset();
  previewState = idle();
  disconnectState = idle();
});

describe('StravaConnectPanel', () => {
  it('offers Connect and nothing else when disconnected', async () => {
    mockState(null);
    render(<StravaConnectPanel />);
    expect(screen.getByText(/Strava not connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/Could not read/i)).toBeNull();

    const connect = screen.getByRole('button', { name: 'Connect Strava' });
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();

    await userEvent.click(connect);
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it('offers Sync now and Disconnect when healthily connected', async () => {
    mockState(connected());
    render(<StravaConnectPanel />);
    expect(screen.getByText(/Last sync/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Strava' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(syncMutate).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(disconnectMutate).not.toHaveBeenCalled();
  });

  it('offers Reconnect and withholds Sync on auth_failed', () => {
    mockState(connected({ last_run_status: 'auth_failed' }));
    render(<StravaConnectPanel />);
    expect(screen.getByText(/revoked/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reconnect' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Disconnect' })
    ).toBeInTheDocument();
  });

  it('lists the offending activity ids on the ambiguous state', () => {
    mockState(connected({ ambiguous_activity_ids: [9001, 9002] }));
    render(<StravaConnectPanel />);
    expect(
      screen.getByText(/2 activities matched more than one existing session/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/9001, 9002/)).toBeInTheDocument();
  });

  it('shows the backfill progress line while importing history', () => {
    mockState(
      connected({
        backfill_complete: false,
        imported_total: 30,
        adopted_total: 4,
      })
    );
    render(<StravaConnectPanel />);
    expect(screen.getByText(/Importing history/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sync now' })
    ).toBeInTheDocument();
  });

  it('disables syncing while the rate limit is in force', () => {
    mockState(
      connected({
        last_run_status: 'rate_limited',
        rate_limit_resets_at: new Date(Date.now() + 600_000).toISOString(),
      })
    );
    render(<StravaConnectPanel />);
    expect(screen.getByText(/rate limit reached/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });

  it('renders the mapped error label on a partial run', () => {
    mockState(
      connected({
        last_run_status: 'partial',
        failed_total: 2,
        last_error_code: 'insufficient_scope',
      })
    );
    render(<StravaConnectPanel />);
    expect(
      screen.getByText(/last sync did not finish cleanly/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 of 7 activities have failed since connecting/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/activity read permission/i)).toBeInTheDocument();
  });

  it('shows a loading line before the status resolves', () => {
    connectionMock.mockReturnValue({
      connection: null,
      status: null,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<StravaConnectPanel />);
    expect(screen.getByText(/Checking Strava connection/i)).toBeInTheDocument();
  });

  it('renders a read failure as an error with a retry, never as "not connected"', async () => {
    const refetch = vi.fn();
    connectionMock.mockReturnValue({
      connection: null,
      status: null,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(<StravaConnectPanel />);
    expect(
      screen.getByText(/Could not read the Strava connection status/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/may be fine/i)).toBeNull();
    expect(screen.queryByText(/Strava not connected/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Strava' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('threads onSynced into the sync mutation', () => {
    const onSynced = vi.fn();
    mockState(connected());
    render(<StravaConnectPanel onSynced={onSynced} />);
    expect(syncFactory).toHaveBeenCalledWith({ onSynced });
  });

  it('renders in compact mode without changing the actions offered', () => {
    mockState(connected());
    render(<StravaConnectPanel compact />);
    expect(
      screen.getByRole('button', { name: 'Sync now' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect' })
    ).toBeInTheDocument();
  });

  it('shows the purge deadline and offers Disconnect on a revoked, disconnected row', () => {
    mockState({
      connected: false,
      last_run_status: 'auth_failed',
      last_error_code: 'auth_failed',
      purge_due_at: '2026-12-08T12:00:00Z',
    });
    render(<StravaConnectPanel />);
    expect(
      screen.getByText(/will be removed on Dec 8, 2026/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reconnect' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect' })
    ).toBeInTheDocument();
  });
});

describe('StravaConnectPanel — disconnect confirmation (#630)', () => {
  const PREVIEW = { toDelete: 4, toKeep: 1, toRestore: 2 };

  async function openWithPreview(preview = PREVIEW) {
    mockState(connected());
    const view = render(<StravaConnectPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    previewState = { ...idle(), isSuccess: true, data: preview };
    view.rerender(<StravaConnectPanel />);
    return view;
  }

  it('Disconnect opens the region, resets the last result and asks for a preview', async () => {
    mockState(connected());
    render(<StravaConnectPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnectReset).toHaveBeenCalledTimes(1);
    expect(previewMutate).toHaveBeenCalledTimes(1);
    const region = screen.getByRole('group', {
      name: 'Disconnect Strava and delete its data?',
    });
    expect(region).toBeInTheDocument();
    // Focus moves to the question so a screen reader announces it.
    expect(document.activeElement).toHaveTextContent(
      'Disconnect Strava and delete its data?'
    );
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
  });

  it('keeps Confirm disabled while the preview loads', async () => {
    mockState(connected());
    const view = render(<StravaConnectPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    previewState = { ...idle(), isPending: true };
    view.rerender(<StravaConnectPanel />);
    expect(
      screen.getByText('Counting the Strava data in your log…')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect and delete' })
    ).toBeDisabled();
  });

  it('AC1: renders the counts before anything changes, and Cancel never disconnects', async () => {
    await openWithPreview();
    expect(
      screen.getByText('4 imported sessions will be deleted.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 imported session with your own sRPE or notes will be kept, without Strava power and heart rate.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Strava power and heart rate will be removed from 2 sessions you logged yourself.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your training load will be recalculated. This cannot be undone.'
      )
    ).toBeInTheDocument();
    expect(disconnectMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(disconnectMutate).not.toHaveBeenCalled();
    expect(previewReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('renders the orphan line when the preview has sessions to unlink', async () => {
    await openWithPreview({ ...PREVIEW, toUnlink: 2 });
    expect(
      screen.getByText(
        '2 sessions linked to Strava outside the importer will be kept as they are, with the Strava link removed.'
      )
    ).toBeInTheDocument();
  });

  it('shows the all-zero preview and still lets the user disconnect', async () => {
    await openWithPreview({ toDelete: 0, toKeep: 0, toRestore: 0 });
    expect(
      screen.getByText(
        'Nothing in your log came from Strava; nothing will be removed.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Disconnect and delete' })
    ).toBeEnabled();
  });

  it('Confirm calls disconnect once and closes the region on success', async () => {
    const view = await openWithPreview();
    await userEvent.click(
      screen.getByRole('button', { name: 'Disconnect and delete' })
    );
    expect(disconnectMutate).toHaveBeenCalledTimes(1);
    const [, options] = disconnectMutate.mock.calls[0];
    disconnectState = {
      ...idle(),
      isSuccess: true,
      data: { removed: 4, kept: 1, restored: 2, revocation: 'revoked' },
    };
    act(() => options.onSuccess());
    view.rerender(<StravaConnectPanel />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('double-click guard: Confirm and Cancel are disabled while the disconnect runs', async () => {
    const view = await openWithPreview();
    disconnectState = { ...idle(), isPending: true };
    view.rerender(<StravaConnectPanel />);
    const confirm = screen.getByRole('button', { name: 'Disconnecting…' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.click(confirm);
    expect(disconnectMutate).not.toHaveBeenCalled();
  });

  it('double-click guard: two rapid Confirm clicks before isPending re-renders call disconnect once', async () => {
    await openWithPreview();
    // disconnectState stays idle: the second click lands before isPending
    // would have re-rendered the button disabled.
    const confirm = screen.getByRole('button', {
      name: 'Disconnect and delete',
    });
    await userEvent.dblClick(confirm);
    expect(disconnectMutate).toHaveBeenCalledTimes(1);

    // Once the call settles (e.g. it failed), Confirm works again for a retry.
    const [, options] = disconnectMutate.mock.calls[0];
    act(() => options.onSettled());
    await userEvent.click(confirm);
    expect(disconnectMutate).toHaveBeenCalledTimes(2);
  });

  it('AC3: a failed disconnect shows the failure text, keeps the region and no success notice', async () => {
    const view = await openWithPreview();
    disconnectState = { ...idle(), isError: true };
    view.rerender(<StravaConnectPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Disconnect failed. Nothing was changed. Try again.'
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Strava disconnected/)).toBeNull();
    // The user can retry straight from the region.
    expect(
      screen.getByRole('button', { name: 'Disconnect and delete' })
    ).toBeEnabled();
  });

  it('a failed preview offers a retry and withholds Confirm', async () => {
    mockState(connected());
    const view = render(<StravaConnectPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    previewState = { ...idle(), isError: true };
    view.rerender(<StravaConnectPanel />);
    expect(
      screen.getByText(
        'Could not count the Strava data in your log. Try again.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Disconnect and delete' })
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(previewMutate).toHaveBeenCalledTimes(2);
    expect(disconnectMutate).not.toHaveBeenCalled();
  });

  it('AC6: the result notice shows the actual counts and persists once the row is gone', () => {
    disconnectState = {
      ...idle(),
      isSuccess: true,
      data: { removed: 4, kept: 1, restored: 2, revocation: 'revoked' },
    };
    // The connection query has refetched: the purge deleted the sync row.
    mockState(null);
    render(<StravaConnectPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Strava disconnected. 4 imported sessions deleted. 1 imported session kept, without Strava power and heart rate. Strava power and heart rate removed from 2 sessions you logged yourself. Access at Strava revoked.'
    );
    expect(screen.getByText(/Strava not connected/i)).toBeInTheDocument();
  });

  it('AC6: an unconfirmed revocation tells the user where to remove access', () => {
    disconnectState = {
      ...idle(),
      isSuccess: true,
      data: { removed: 0, kept: 0, restored: 0, revocation: 'failed' },
    };
    mockState(null);
    render(<StravaConnectPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Remove SplitIQ in Strava → Settings → My Apps.'
    );
  });
});
