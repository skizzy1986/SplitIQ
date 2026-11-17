import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionOwnerContext } from '../useSessionOwner.js';
import { stravaOkBody } from '../../test/sessionFixtures.js';

const invoke = vi.fn();
vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...a) => invoke(...a) } },
}));

import { useStravaActivity } from '../useStravaActivity.js';

// No test-level retry override: the hook's own `retry: false` must hold even
// though the app's default retries.
function wrapperFor(client, actor = 'u-test') {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>
        <SessionOwnerContext.Provider value={actor}>
          {children}
        </SessionOwnerContext.Provider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => invoke.mockReset());

describe('useStravaActivity', () => {
  it('invokes strava-activity with the session id and an abort signal', async () => {
    invoke.mockResolvedValue({ data: stravaOkBody({ n: 5 }), error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useStravaActivity(42), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('strava-activity');
    expect(opts.body).toEqual({ session_id: 42 });
    expect(opts.signal).toBeInstanceOf(globalThis.AbortSignal);
    expect(result.current.data.status).toBe('ok');
    const query = client.getQueryCache().find({
      queryKey: ['strava', 'activity', 'u-test', 42],
    });
    expect(query.options.staleTime).toBe(30 * 60_000);
    expect(query.options.gcTime).toBe(30 * 60_000);
    expect(query.options.refetchOnWindowFocus).toBe(false);
  });

  it('throws on an invoke error without retrying', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
    });
    const { result } = renderHook(() => useStravaActivity(42), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('throws on a status the contract does not have', async () => {
    invoke.mockResolvedValue({ data: { status: 'weird' }, error: null });
    const { result } = renderHook(() => useStravaActivity(42), {
      wrapper: wrapperFor(new QueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('passes typed outcomes through', async () => {
    invoke.mockResolvedValue({
      data: { status: 'rate_limited', retry_at: '2026-11-10T09:15:00Z' },
      error: null,
    });
    const { result } = renderHook(() => useStravaActivity(42), {
      wrapper: wrapperFor(new QueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.retry_at).toBe('2026-11-10T09:15:00Z');
  });

  it('does not call without an actor, a valid id, or when disabled', () => {
    const client = new QueryClient();
    renderHook(() => useStravaActivity(42, { enabled: false }), {
      wrapper: wrapperFor(client),
    });
    renderHook(() => useStravaActivity(null), { wrapper: wrapperFor(client) });
    renderHook(() => useStravaActivity(42), {
      wrapper: wrapperFor(client, null),
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
