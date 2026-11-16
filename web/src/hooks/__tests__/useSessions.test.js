import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { SessionOwnerContext } from '../useSessionOwner.js';
import { invalidateSessionQueries } from '../../utils/invalidateSessionQueries.js';

const fromMock = vi.fn();
vi.mock('../../supabaseClient.js', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));
import { useSessions } from '../useSessions.js';

let requests;
let source;
let pageCap;
let failAt;
let countAvailable;
let holdResponse;
let actor;
let client;

beforeEach(() => {
  source = [];
  pageCap = 500;
  failAt = null;
  countAvailable = true;
  holdResponse = false;
  actor = 'athlete-a';
  requests = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  fromMock.mockReset();
  fromMock.mockImplementation(() => {
    const request = { offset: 0, limit: Infinity, orders: [] };
    requests.push(request);
    const chain = {
      select: (fields, options) => {
        request.fields = fields;
        request.options = options;
        return chain;
      },
      eq: (field, owner) => {
        request.owner = owner;
        request.filter = field;
        return chain;
      },
      order: (field, options) => {
        request.orders.push([field, options]);
        return chain;
      },
      range: (from, to) => {
        request.range = [from, to];
        request.offset = from;
        request.limit = to - from + 1;
        return chain;
      },
      limit: (limit) => {
        request.limit = limit;
        return chain;
      },
      abortSignal: (signal) => {
        request.signal = signal;
        if (holdResponse) return new Promise(() => {});
        return Promise.resolve({
          data:
            source?.slice(
              request.offset,
              request.offset + Math.min(request.limit, pageCap)
            ) ?? null,
          error:
            failAt === request.offset ? new Error('network failure') : null,
          count: countAvailable ? (source?.length ?? 0) : null,
        });
      },
    };
    return chain;
  });
});
afterEach(() => client.clear());

function Wrapper({ children }) {
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(
      SessionOwnerContext.Provider,
      { value: actor },
      children
    )
  );
}
function mount(options) {
  // Subscribe to data during render, as real views do (Query tracks accessed fields).
  return renderHook(() => ({ ...useSessions(options) }), { wrapper: Wrapper });
}
async function ready(result) {
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: n - i,
    date: '8/7/26',
    user_id: actor,
    type: 'erg',
    status: 'actual',
  }));

describe('shared owner-scoped sessions', () => {
  it('reads the union of display fields, filters owner, orders date/id and limits recent history to 50', async () => {
    source = rows(80);
    const { result } = mount();
    await ready(result);
    expect(result.current.data).toHaveLength(50);
    expect(requests[0]).toMatchObject({
      filter: 'user_id',
      owner: actor,
      limit: 50,
      orders: [
        ['date_iso', { ascending: false, nullsFirst: false }],
        ['id', { ascending: false }],
      ],
    });
    expect(requests[0].fields.split(', ')).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'date',
        'date_iso',
        'prs',
        'exercises',
        'coach_note',
        'avg_watts',
        'avg_hr',
        'distance_m',
      ])
    );
    expect(requests[0].signal).toBeInstanceOf(window.AbortSignal);
  });

  it('reads all 1251 sessions through 500-row pages instead of stopping at 50 or the server cap', async () => {
    source = rows(1251);
    const { result } = mount({ mode: 'all' });
    await ready(result);
    expect(result.current.data).toHaveLength(1251);
    expect(requests.map((r) => r.range)).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
    expect(
      requests.every((r) => r.owner === actor && r.options.count === 'exact')
    ).toBe(true);
    expect(result.current.data.map((r) => r.id)).toEqual(
      source.map((r) => r.id)
    );
  });

  it('continues when the server returns fewer than 500 while its exact count says more remain', async () => {
    pageCap = 100;
    source = rows(251);
    const { result } = mount({ mode: 'all' });
    await ready(result);
    expect(result.current.data).toHaveLength(251);
    expect(requests.map((r) => r.range)).toEqual([
      [0, 499],
      [100, 599],
      [200, 699],
    ]);
  });

  it('ends safely on empty data and without a count header', async () => {
    source = rows(500);
    countAvailable = false;
    const { result } = mount({ mode: 'all' });
    await ready(result);
    expect(result.current.data).toHaveLength(500);
    expect(requests.map((r) => r.range)).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });

  it('sorts date text across month/year boundaries, leaves invalid dates last and preserves tie order', async () => {
    source = [
      { id: 1, date: 'garbage' },
      { id: 2, date: '12/31/25' },
      { id: 9, date: '6/4/26' },
      { id: 3, date: '6/4/26' },
      { id: 4, date: '12/1/26' },
    ];
    const { result } = mount();
    await ready(result);
    expect(result.current.data.map((r) => r.id)).toEqual([4, 9, 3, 2, 1]);
    expect(source[0].date).toBe('garbage');
  });

  it('returns an empty array for a null payload', async () => {
    source = null;
    const { result } = mount();
    await ready(result);
    expect(result.current.data).toEqual([]);
  });

  it('fails the whole history query when a later page fails instead of publishing a partial total', async () => {
    source = rows(600);
    failAt = 500;
    const { result } = mount({ mode: 'all' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error.message).toBe('network failure');
  });

  it.each([null, 'different-owner'])(
    'denies absent/cross-owner context (%s), including manual refetch',
    async (subject) => {
      if (subject === null) actor = null;
      const { result } = mount(subject ? { subjectId: subject } : undefined);
      expect(fromMock).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.refetch();
      });
      expect(fromMock).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.data).toEqual([]));
    }
  );

  it('uses separate actor/subject/mode keys and never carries a prior actor result into the new key', async () => {
    source = rows(1);
    const { result, rerender } = mount();
    await ready(result);
    expect(
      client.getQueryData(['sessions', 'athlete-a', 'athlete-a', 'recent'])
    ).toHaveLength(1);
    actor = 'athlete-b';
    source = [];
    rerender();
    expect(result.current.data).toBeUndefined();
    await ready(result);
    expect(result.current.data).toEqual([]);
    expect(requests.at(-1).owner).toBe('athlete-b');
    const all = mount({ mode: 'all' });
    await ready(all.result);
    expect(
      client.getQueryData(['sessions', 'athlete-b', 'athlete-b', 'all'])
    ).toEqual([]);
  });

  it('aborts an in-flight Supabase read when account cleanup clears its query cache', async () => {
    holdResponse = true;
    mount({ mode: 'all' });
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    act(() => client.clear());
    expect(requests[0].signal.aborted).toBe(true);
  });

  it('prefix invalidation refreshes both recent and all-history readers', async () => {
    source = rows(1);
    const recent = mount();
    const all = mount({ mode: 'all' });
    await ready(recent.result);
    await ready(all.result);
    source = rows(2);
    act(() => invalidateSessionQueries(client));
    await waitFor(() => expect(recent.result.current.data).toHaveLength(2));
    await waitFor(() => expect(all.result.current.data).toHaveLength(2));
  });
});
