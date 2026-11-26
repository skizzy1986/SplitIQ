import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/react';
import {
  handleQueryError,
  handleMutationError,
} from '../queryErrorHandlers.js';

// The sibling test mocks ../sentry.js to prove what the handlers pass on. This
// one keeps the real captureError and mocks the SDK, so it proves what Sentry
// is actually handed (#819, slice S0: query and mutation keys carry no values).
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}));

beforeEach(() => vi.clearAllMocks());

describe('query and mutation keys reaching Sentry (#819)', () => {
  it('handleQueryError passes a value-free key to Sentry unchanged', () => {
    handleQueryError(new Error('select failed'), {
      queryKey: ['strava', 'connection'],
    });

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra).toEqual({
      source: 'react-query',
      kind: 'query',
      queryKey: ['strava', 'connection'],
    });
  });

  it('handleQueryError replaces a value in the key with *', () => {
    handleQueryError(new Error('select failed'), {
      queryKey: ['sessions', 237, '1986-11-26', 'detail'],
    });

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra.queryKey).toEqual(['sessions', '*', '*', 'detail']);
    expect(JSON.stringify(extra)).not.toMatch(/237|1986/);
  });

  it('handleMutationError replaces a value in the key with *', () => {
    handleMutationError(new Error('insert failed'), { watts: 237 }, undefined, {
      options: { mutationKey: ['anchors', 'save', 172] },
    });

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra.mutationKey).toEqual(['anchors', 'save', '*']);
    expect(JSON.stringify(extra)).not.toMatch(/237|172/);
  });

  it('never forwards the mutation variables', () => {
    handleMutationError(
      { code: '23505', message: 'duplicate' },
      { watts: 237, birthYear: 1986 },
      undefined,
      { options: { mutationKey: ['anchors'] } }
    );

    expect(JSON.stringify(Sentry.captureException.mock.calls)).not.toMatch(
      /237|1986/
    );
  });
});
