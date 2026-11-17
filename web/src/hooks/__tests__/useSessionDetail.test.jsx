import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionOwnerContext } from '../useSessionOwner.js';

const calls = [];
const result = { data: null, error: null };
vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: (table) => {
      const chain = {};
      for (const m of ['select', 'eq', 'abortSignal']) {
        chain[m] = (...a) => {
          calls.push([m, ...a]);
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(result);
      calls.push(['from', table]);
      return chain;
    },
  },
}));

import { useSessionDetail } from '../useSessionDetail.js';

const wrapper = (actor) =>
  function Wrapper({ children }) {
    return (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <SessionOwnerContext.Provider value={actor}>
          {children}
        </SessionOwnerContext.Provider>
      </QueryClientProvider>
    );
  };

beforeEach(() => {
  calls.length = 0;
  result.data = null;
  result.error = null;
});

describe('useSessionDetail', () => {
  it('reads one row by id and owner, with the source columns', async () => {
    result.data = { id: 7, type: 'erg' };
    const { result: r } = renderHook(() => useSessionDetail(7), {
      wrapper: wrapper('u-test'),
    });
    await waitFor(() => expect(r.current.isSuccess).toBe(true));
    expect(r.current.data).toEqual({ id: 7, type: 'erg' });
    expect(calls).toContainEqual(['from', 'sessions']);
    const select = calls.find((c) => c[0] === 'select')[1];
    expect(select).toMatch(/strava_activity_id/);
    expect(select).toMatch(/\bsource\b/);
    expect(calls).toContainEqual(['eq', 'id', 7]);
    expect(calls).toContainEqual(['eq', 'user_id', 'u-test']);
    expect(calls.some((c) => c[0] === 'abortSignal')).toBe(true);
  });

  it('turns no row (another user, or none) into null', async () => {
    const { result: r } = renderHook(() => useSessionDetail(8), {
      wrapper: wrapper('u-test'),
    });
    await waitFor(() => expect(r.current.isSuccess).toBe(true));
    expect(r.current.data).toBeNull();
  });

  it('does not query without an actor or an integer id', () => {
    renderHook(() => useSessionDetail(7), { wrapper: wrapper(null) });
    renderHook(() => useSessionDetail(1.5), { wrapper: wrapper('u-test') });
    expect(calls).toEqual([]);
  });
});
