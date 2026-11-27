import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const fromMock = vi.fn();
vi.mock('../../supabaseClient.js', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

import {
  TRAINING_SETTINGS_KEY,
  useTrainingSettings,
  useUpdateTrainingSettings,
} from '../useTrainingSettings.js';

function makeWrapper(client) {
  return function Wrapper({ children }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}
const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockRead(result) {
  const chain = {
    select: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  fromMock.mockReturnValue(chain);
}

beforeEach(() => fromMock.mockReset());

describe('useTrainingSettings', () => {
  it('reads the account row and exposes the path, year and depth', async () => {
    mockRead({
      data: { hr_path: 'strap', birth_year: 1985, depth: 'expert' },
      error: null,
    });
    const { result } = renderHook(() => useTrainingSettings(), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toMatchObject({
      available: true,
      hasRow: true,
      hrPath: 'strap',
      birthYear: 1985,
      depth: 'expert',
    });
    expect(fromMock).toHaveBeenCalledWith('user_training_settings');
  });

  it('reads an account with no row as defaults', async () => {
    mockRead({ data: null, error: null });
    const { result } = renderHook(() => useTrainingSettings(), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current).toMatchObject({
      available: true,
      hasRow: false,
      hrPath: null,
      birthYear: null,
      depth: 'simple',
    });
    expect(result.current.settings.hr_caution).toBe(false);
  });

  it.each(['42P01', 'PGRST205', '42703'])(
    'treats a missing table or column (%s) as defaults, not an error',
    async (code) => {
      mockRead({ data: null, error: { code, message: 'missing' } });
      const { result } = renderHook(() => useTrainingSettings(), {
        wrapper: makeWrapper(newClient()),
      });
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.available).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.depth).toBe('simple');
    }
  );

  it('still throws any other read error', async () => {
    mockRead({ data: null, error: { code: '42501', message: 'denied' } });
    const { result } = renderHook(() => useTrainingSettings(), {
      wrapper: makeWrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.loaded).toBe(false);
  });

  it('H42: query and mutation keys carry no values', () => {
    expect(TRAINING_SETTINGS_KEY).toEqual(['trainingSettings']);
  });
});

describe('useUpdateTrainingSettings', () => {
  it('upserts only writable columns, stamps updated_at and refreshes the read', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert });
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTrainingSettings(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        hr_path: 'strap',
        hr_path_chosen_on: '2026-11-27',
        user_id: 'someone-else',
        calibrate_from_strava: true,
      });
    });
    const [values, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'user_id' });
    expect(Object.keys(values).sort()).toEqual(
      ['hr_path', 'hr_path_chosen_on', 'updated_at'].sort()
    );
    expect(new Date(values.updated_at).toString()).not.toBe('Invalid Date');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: TRAINING_SETTINGS_KEY,
    });
  });

  it('removes a year of birth by writing null', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert });
    const { result } = renderHook(() => useUpdateTrainingSettings(), {
      wrapper: makeWrapper(newClient()),
    });
    await act(async () => {
      await result.current.mutateAsync({ birth_year: null });
    });
    expect(upsert.mock.calls[0][0]).toMatchObject({ birth_year: null });
  });

  it('rejects when the write fails, so the caller can say so', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    fromMock.mockReturnValue({ upsert });
    const { result } = renderHook(() => useUpdateTrainingSettings(), {
      wrapper: makeWrapper(newClient()),
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ depth: 'expert' })
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
