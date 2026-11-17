import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invoke = vi.fn();
vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...a) => invoke(...a) } },
}));

import { useStravaConnect } from '../useStravaConnect.js';

// After a disconnect no Strava-derived trace may stay in memory (#648).
describe('useStravaConnect — disconnect clears cached traces', () => {
  const setup = () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(['strava', 'activity', 'u-test', 1], { status: 'ok' });
    client.setQueryData(['strava', 'activity', 'u-test', 2], { status: 'ok' });
    client.setQueryData(['strava', 'connection'], { connected: true });
    const wrapper = ({ children }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    return { client, result };
  };

  it('removes every activity query on a successful disconnect', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, disconnected: true, removed: 1, kept: 0, restored: 0 },
      error: null,
    });
    const { client, result } = setup();
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isSuccess).toBe(true));
    expect(
      client.getQueryCache().findAll({ queryKey: ['strava', 'activity'] })
    ).toHaveLength(0);
    // Only the activity traces go; the connection query is invalidated, kept.
    expect(client.getQueryData(['strava', 'connection'])).toEqual({
      connected: true,
    });
  });

  it('keeps them when the disconnect fails', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') });
    const { client, result } = setup();
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isError).toBe(true));
    expect(
      client.getQueryCache().findAll({ queryKey: ['strava', 'activity'] })
    ).toHaveLength(2);
  });
});
