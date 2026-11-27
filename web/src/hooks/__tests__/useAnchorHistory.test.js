import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const fromMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

import { useAnchorHistory, anchorHistoryKey } from '../useAnchorHistory.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

// Records every call so the test can pin the query shape.
function mockHistory(data, error = null) {
  const calls = { select: [], eq: [], order: [], insert: 0, update: 0 };
  const chain = {
    select: (cols) => {
      calls.select.push(cols);
      return chain;
    },
    eq: (col, val) => {
      calls.eq.push([col, val]);
      return chain;
    },
    order: (col, opts) => {
      calls.order.push([col, opts]);
      return calls.order.length === 2
        ? Promise.resolve({ data, error })
        : chain;
    },
    insert: () => {
      calls.insert += 1;
    },
    update: () => {
      calls.update += 1;
    },
  };
  fromMock.mockReturnValue(chain);
  return calls;
}

beforeEach(() => {
  fromMock.mockReset();
});

describe('useAnchorHistory', () => {
  it('A44: retired rows for the signed-in user only', async () => {
    // RLS (anchors_owner) scopes the read to the caller; the hook adds no
    // user_id filter and asks for one key, newest valid_from first, ties to
    // the latest created_at.
    const calls = mockHistory([
      { id: 'b', value: '235', valid_from: '2026-11-20', superseded_at: null },
      {
        id: 'a',
        value: '220',
        valid_from: '2026-11-01',
        superseded_at: '2026-11-20T01:00:00Z',
      },
    ]);
    const { result } = renderHook(() => useAnchorHistory('rowing_cp'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith('anchors');
    expect(calls.eq).toEqual([['key', 'rowing_cp']]);
    expect(calls.select[0]).not.toMatch(/user_id/);
    expect(calls.select[0]).toMatch(/reason/);
    expect(calls.select[0]).toMatch(/provenance/);
    expect(calls.order).toEqual([
      ['valid_from', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(calls.insert + calls.update).toBe(0);
    expect(result.current.available).toBe(true);
    expect(result.current.live.id).toBe('b');
    expect(result.current.retired.map((r) => r.id)).toEqual(['a']);
  });

  it('a project without 028 reads as unavailable, not as an error', async () => {
    mockHistory(null, { code: '42703', message: 'column does not exist' });
    const { result } = renderHook(() => useAnchorHistory('rowing_cp'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.available).toBe(false);
    expect(result.current.live).toBeNull();
    expect(result.current.retired).toEqual([]);
  });

  it('other errors surface as errors', async () => {
    mockHistory(null, { code: '500', message: 'boom' });
    const { result } = renderHook(() => useAnchorHistory('rowing_cp'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('does not read when disabled', () => {
    mockHistory([]);
    renderHook(() => useAnchorHistory('rowing_cp', { enabled: false }), {
      wrapper: makeWrapper(),
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('keys the cache per anchor key', () => {
    expect(anchorHistoryKey('max_hr')).toEqual(['anchorHistory', 'max_hr']);
  });
});
