import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock the supabase client before importing the hook under test.
const insertMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: { getUser: (...args) => getUserMock(...args) },
    from: () => ({ insert: (...args) => insertMock(...args) }),
  },
}));

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

import { SessionOwnerContext } from '../useSessionOwner.js';
import { captureError } from '../../utils/sentry.js';
import {
  enqueueSession as rawEnqueueSession,
  useOfflineQueue,
  normalizeQueuedSession,
} from '../useOfflineQueue';

const QUEUE_KEY = 'erg_pending_sessions';
const enqueueSession = (row) =>
  rawEnqueueSession({ user_id: 'user-123', ...row });

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeWrapper(client, owner = 'user-123') {
  return function Wrapper({ children }) {
    return React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        SessionOwnerContext.Provider,
        { value: owner },
        children
      )
    );
  };
}

beforeEach(async () => {
  // drainQueue holds a module-level in-flight guard; let any drain started by
  // the previous test settle before resetting shared state.
  await new Promise((resolve) => setTimeout(resolve, 0));
  localStorage.clear();
  insertMock.mockReset();
  getUserMock.mockReset();
  captureError.mockClear();
  insertMock.mockResolvedValue({ error: null });
  // navigator.onLine defaults to true under jsdom; ensure drain runs.
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

describe('useOfflineQueue replay ownership', () => {
  it('never attributes a legacy row with missing user_id to the next authenticated account', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    rawEnqueueSession({
      date: '2026-06-25',
      type: 'erg',
      label: 'Unknown owner',
    });
    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(getUserMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(insertMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toHaveLength(1);
  });

  it('does not replay a row owned by another account', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    enqueueSession({
      date: '2026-06-25',
      type: 'erg',
      user_id: 'original-owner',
    });
    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(getUserMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(insertMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY))[0].user_id).toBe(
      'original-owner'
    );
  });

  it('does not attempt an insert without a verified replay user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    enqueueSession({ date: '2026-06-25', type: 'erg' });
    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(getUserMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('retains rows that fail to insert so they can be retried', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    const failure = { code: '08006', message: 'network' };
    insertMock.mockResolvedValue({ error: failure });
    enqueueSession({ date: '2026-06-25', type: 'erg' });

    renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const remaining = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(remaining).toHaveLength(1);
    await waitFor(() => expect(captureError).toHaveBeenCalledTimes(1));
    expect(captureError).toHaveBeenCalledWith(failure, {
      source: 'useOfflineQueue',
      op: 'drainQueue',
    });
  });
});

describe('normalizeQueuedSession', () => {
  it('renames legacy columns that do not exist on the sessions table', () => {
    expect(
      normalizeQueuedSession({
        date: '2026-06-25',
        watts: 180,
        distance: 5000,
        duration: 20,
      })
    ).toEqual({
      date: '6/25/26',
      avg_watts: 180,
      distance_m: 5000,
      duration: '20',
    });
  });

  it('preserves _queuedAt and unknown keys', () => {
    const out = normalizeQueuedSession({
      _queuedAt: 1234,
      srpe: 5,
      somethingNew: 'keep me',
      watts: 200,
    });
    expect(out._queuedAt).toBe(1234);
    expect(out.srpe).toBe(5);
    expect(out.somethingNew).toBe('keep me');
    expect(out.avg_watts).toBe(200);
  });

  it('is idempotent', () => {
    const once = normalizeQueuedSession({
      date: '2026-06-25',
      watts: 180,
      distance: 5000,
      duration: 20,
    });
    expect(normalizeQueuedSession(once)).toEqual(once);
  });

  it('does not clobber a modern value with the legacy one', () => {
    const out = normalizeQueuedSession({
      watts: 999,
      avg_watts: 180,
      distance: 999,
      distance_m: 5000,
    });
    expect(out.avg_watts).toBe(180);
    expect(out.distance_m).toBe(5000);
    expect(out).not.toHaveProperty('watts');
    expect(out).not.toHaveProperty('distance');
  });

  it('leaves a missing date alone rather than inventing today', () => {
    expect(normalizeQueuedSession({ type: 'erg' })).toEqual({ type: 'erg' });
  });
});

describe('useOfflineQueue legacy-row migration', () => {
  it('drains a legacy-shaped row using the real sessions columns', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    enqueueSession({
      date: '2026-06-25',
      type: 'erg',
      label: 'Erg Session',
      watts: 180,
      distance: 5000,
    });

    renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const row = insertMock.mock.calls[0][0];
    expect(row.avg_watts).toBe(180);
    expect(row.distance_m).toBe(5000);
    expect(row.date).toBe('6/25/26');
    expect(row).not.toHaveProperty('watts');
    expect(row).not.toHaveProperty('distance');
  });

  it('rewrites storage in the normalized shape when the drain fails', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    insertMock.mockResolvedValue({
      error: { code: '08006', message: 'network' },
    });
    enqueueSession({
      date: '2026-06-25',
      type: 'erg',
      watts: 180,
      distance: 5000,
    });

    renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const [remaining] = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(remaining.avg_watts).toBe(180);
    expect(remaining.distance_m).toBe(5000);
    expect(remaining.date).toBe('6/25/26');
    expect(remaining).not.toHaveProperty('watts');
    expect(remaining._queuedAt).toEqual(expect.any(Number));
  });

  it('drops a row the server rejects as a duplicate', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    insertMock.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates …' },
    });
    enqueueSession({
      date: '6/25/26',
      type: 'erg',
      label: 'Erg Session 07:15',
    });

    const { result } = renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(localStorage.getItem(QUEUE_KEY)).toBe('[]');
    // A duplicate-key conflict means the row already landed — reporting it
    // would turn every successful offline retry into Sentry noise.
    expect(captureError).not.toHaveBeenCalled();
  });

  it('inserts each row at most once when two drains race', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    let release;
    insertMock.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ error: null })))
    );
    enqueueSession({
      date: '6/25/26',
      type: 'erg',
      label: 'Erg Session 07:15',
    });

    renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));

    // A second trigger while the first drain is still awaiting the insert.
    window.dispatchEvent(new window.Event('online'));
    await Promise.resolve();
    release();

    await waitFor(() => expect(localStorage.getItem(QUEUE_KEY)).toBe('[]'));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe('useOfflineQueue drain invalidation', () => {
  it('invalidates every session-reading query once after a successful drain', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'Erg Session' });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['erg-sessions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tss-history'] });
  });

  it('invalidates nothing when the queue is empty', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(client) });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(insertMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates nothing when every queued row fails to insert', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    insertMock.mockResolvedValue({
      error: { code: '08006', message: 'network' },
    });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'A' });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'B' });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY))).toHaveLength(2);
  });

  it('invalidates once after the loop, not once per drained row', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'A' });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'B' });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'C' });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  it('still invalidates on a partial drain and retains the failed row', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    insertMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: '08006', message: 'network' } });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'lands' });
    enqueueSession({ date: '6/25/26', type: 'erg', label: 'fails' });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useOfflineQueue(), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));
    const remaining = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].label).toBe('fails');
  });
});

describe('offline replay across an account change', () => {
  it('does not duplicate or overwrite the queue after an in-flight insert fails across an account change', async () => {
    const { startPrivateSession } =
      await import('../../utils/privateSessionState.js');
    getUserMock.mockResolvedValue({ data: { user: { id: 'account-A' } } });
    let resolveInsert;
    insertMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInsert = resolve;
        })
    );
    enqueueSession({ date: '1/2/26', type: 'erg', user_id: 'account-A' });
    renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient(), 'account-A'),
    });
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    startPrivateSession();
    enqueueSession({ date: '1/3/26', type: 'erg', user_id: 'account-B' });
    resolveInsert({ error: { code: '08006', message: 'old request failed' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A's row is retained once for A's own replay; the stale drain neither
    // duplicates it nor drops B's row.
    const rows = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(rows.map((row) => row.user_id)).toEqual(['account-A', 'account-B']);
  });
});

describe('offline queue producer and drain races', () => {
  it('rejects a retained producer callback after an account change', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    const { startPrivateSession } =
      await import('../../utils/privateSessionState.js');
    const { result } = renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });
    const oldAdd = result.current.addToQueue;
    startPrivateSession();
    enqueueSession({
      date: '6/26/26',
      label: 'new account',
      user_id: 'account-B',
    });
    act(() => {
      expect(oldAdd({ date: '6/25/26', label: 'old account' })).toBe(false);
    });
    expect(
      JSON.parse(localStorage.getItem(QUEUE_KEY)).map((row) => row.label)
    ).toEqual(['new account']);
  });

  it('stamps the current context owner and refuses a mismatched supplied owner', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    const { result } = renderHook(() => useOfflineQueue(), {
      wrapper: makeWrapper(makeClient()),
    });
    act(() => {
      result.current.addToQueue({ date: '6/25/26', label: 'offline' });
    });
    act(() => {
      expect(
        result.current.addToQueue({
          date: '6/25/26',
          label: 'foreign',
          user_id: 'other',
        })
      ).toBe(false);
    });
    const rows = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('user-123');
  });

  it.each([false, true])(
    'preserves work appended during an in-flight drain (insert fails: %s)',
    async (failed) => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });
      let release;
      insertMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      enqueueSession({ date: '6/25/26', label: 'first' });
      renderHook(() => useOfflineQueue(), {
        wrapper: makeWrapper(makeClient()),
      });
      await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
      enqueueSession({ date: '6/25/26', label: 'appended' });
      const appendedId = JSON.parse(localStorage.getItem(QUEUE_KEY))[1]
        ._queueId;
      expect(insertMock.mock.calls[0][0]).not.toHaveProperty('_queueId');
      expect(insertMock.mock.calls[0][0]).not.toHaveProperty('_queuedAt');
      release({ error: failed ? { code: '08006', message: 'network' } : null });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const remaining = JSON.parse(localStorage.getItem(QUEUE_KEY));
      expect(remaining.map((row) => row.label)).toEqual(
        failed ? ['first', 'appended'] : ['appended']
      );
      expect(remaining.at(-1)._queueId).toBe(appendedId);
    }
  );
});

it('does not show unknown or foreign work in the current owner pending count', () => {
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });
  rawEnqueueSession({ user_id: 'other', label: 'foreign' });
  rawEnqueueSession({ label: 'unknown' });
  enqueueSession({ label: 'mine' });
  const { result } = renderHook(() => useOfflineQueue(), {
    wrapper: makeWrapper(makeClient()),
  });
  expect(result.current.pending).toBe(1);
});

it('does not queue or replay without an authenticated owner context', async () => {
  enqueueSession({ label: 'existing' });
  const { result } = renderHook(() => useOfflineQueue(), {
    wrapper: makeWrapper(makeClient(), null),
  });
  act(() => {
    expect(
      result.current.addToQueue({ user_id: 'user-123', label: 'new' })
    ).toBe(false);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getUserMock).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(result.current.pending).toBe(0);
});
