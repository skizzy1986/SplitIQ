import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invokeMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...args) => invokeMock(...args) } },
}));

import { useReportProblem } from '../useReportProblem.js';

let client;

function wrapper({ children }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

const report = {
  what: 'The log did not save',
  steps: 'Opened Train, then Log',
  version: '1.3.0',
  route: '/settings',
  platform: 'web',
  email: 'person@example.com',
  userId: 'not-the-session',
};

beforeEach(() => {
  invokeMock.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe('useReportProblem', () => {
  it('sends the report fields and leaves email and user id off the body', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useReportProblem(), { wrapper });
    result.current.mutate(report);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('report-problem', {
      body: {
        what: 'The log did not save',
        steps: 'Opened Train, then Log',
        version: '1.3.0',
        route: '/settings',
        platform: 'web',
      },
    });
    const body = invokeMock.mock.calls[0][1].body;
    expect(body).not.toHaveProperty('email');
    expect(JSON.stringify(body)).not.toContain('person@example.com');
  });

  it('marks a 429 as rate limited and any other failure as delivery', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { context: { status: 429 } },
    });
    const { result } = renderHook(() => useReportProblem(), { wrapper });
    result.current.mutate(report);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.code).toBe('rate_limited');

    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    result.current.mutate(report);
    await waitFor(() =>
      expect(result.current.error.code).toBe('delivery_failed')
    );
  });
});
