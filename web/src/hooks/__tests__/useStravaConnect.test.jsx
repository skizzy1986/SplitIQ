import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cwd } from 'node:process';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invokeMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...args) => invokeMock(...args) } },
}));

import { useStravaConnect } from '../useStravaConnect.js';

let client;
let locationStub;
let realLocation;
let fetchSpy;

function wrapper({ children }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  invokeMock.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // jsdom refuses a real navigation, so location is replaced with a plain
  // object whose href we can read back.
  realLocation = window.location;
  locationStub = {
    href: 'http://localhost/',
    pathname: '/',
    search: '',
    hash: '',
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: locationStub,
  });
  fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: realLocation,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useStravaConnect — start', () => {
  it('navigates to the authorize_url the edge function returns, and never fetches Strava itself', async () => {
    invokeMock.mockResolvedValue({
      data: { authorize_url: 'https://example.test/oauth/authorize?x=1' },
      error: null,
    });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.start.mutate();
    await waitFor(() => expect(result.current.start.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledWith('strava-connect', {
      body: { action: 'start' },
    });
    expect(window.location.href).toBe(
      'https://example.test/oauth/authorize?x=1'
    );

    // The only Strava interaction the browser makes is a top-level navigation.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a bare `url` key — the contract is `authorize_url` alone', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, url: 'https://example.test/oauth/authorize?y=2' },
      error: null,
    });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.start.mutate();
    await waitFor(() => expect(result.current.start.isError).toBe(true));
    expect(window.location.href).not.toContain('example.test');
  });

  it('fails loudly when the function returns no authorize url', async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.start.mutate();
    await waitFor(() => expect(result.current.start.isError).toBe(true));
    expect(window.location.href).toBe('http://localhost/');
  });

  it('surfaces an edge-function error without navigating', async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.start.mutate();
    await waitFor(() => expect(result.current.start.isError).toBe(true));
    expect(window.location.href).toBe('http://localhost/');
  });
});

describe('useStravaConnect — disconnect preview', () => {
  it('asks for the preview and resolves the three counts, with no write', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        preview: { toDelete: 4, toKeep: 1, toRestore: 2, toUnlink: 3 },
      },
      error: null,
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.preview.mutate();
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('strava-connect', {
      body: { action: 'disconnect_preview' },
    });
    expect(result.current.preview.data).toEqual({
      toDelete: 4,
      toKeep: 1,
      toRestore: 2,
      toUnlink: 3,
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('missing toUnlink defaults to 0 (an older edge function still previews)', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, preview: { toDelete: 4, toKeep: 1, toRestore: 2 } },
      error: null,
    });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.preview.mutate();
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
    expect(result.current.preview.data).toEqual({
      toDelete: 4,
      toKeep: 1,
      toRestore: 2,
      toUnlink: 0,
    });
  });

  it('treats a preview without integer counts as an error, never as zeros', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.preview.mutate();
    await waitFor(() => expect(result.current.preview.isError).toBe(true));
  });

  it('surfaces a 502 from the function as an error', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.preview.mutate();
    await waitFor(() => expect(result.current.preview.isError).toBe(true));
  });
});

describe('useStravaConnect — disconnect', () => {
  it('sends confirm:true, resolves the counts and invalidates connection and session queries', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        disconnected: true,
        removed: 4,
        kept: 1,
        restored: 2,
        unlinked: 3,
        revocation: 'revoked',
      },
      error: null,
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledWith('strava-connect', {
      body: { action: 'disconnect', confirm: true },
    });
    expect(result.current.disconnect.data).toEqual({
      removed: 4,
      kept: 1,
      restored: 2,
      unlinked: 3,
      revocation: 'revoked',
    });
    const keys = invalidateSpy.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['strava', 'connection'],
        ['sessions'],
        ['erg-sessions'],
        ['tss-history'],
      ])
    );
  });

  it('invalidates nothing when the disconnect fails', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('never opens a browser confirm dialog and exports no confirm constants', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, disconnected: true, removed: 0, kept: 0, restored: 0 },
      error: null,
    });
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    expect(result.current.requestDisconnect).toBeUndefined();
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isSuccess).toBe(true));
    expect(confirmSpy).not.toHaveBeenCalled();

    const mod = await import('../useStravaConnect.js');
    expect(mod.DISCONNECT_CONFIRM).toBeUndefined();
    expect(mod.DISCONNECT_CONFIRM_MSG).toBeUndefined();
  });

  it('a 2xx without a revocation field is reported as unconfirmed, not revoked', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, disconnected: true, removed: 1, kept: 0, restored: 0 },
      error: null,
    });
    const { result } = renderHook(() => useStravaConnect(), { wrapper });
    result.current.disconnect.mutate();
    await waitFor(() => expect(result.current.disconnect.isSuccess).toBe(true));
    expect(result.current.disconnect.data.revocation).toBe('failed');
  });
});

// A security review checkpoint, not a style rule: the browser must never hold a
// Strava endpoint or credential. Asserting it here means the guarantee survives
// a later edit that a one-off grep would not catch.
describe('the browser bundle never references Strava directly', () => {
  // Vitest's root is web/, so this is web/src.
  const SRC = resolve(cwd(), 'src');

  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(js|jsx)$/.test(entry) ? [full] : [];
    });

  // Built by concatenation so this guard does not itself put the forbidden
  // strings into src/ — a plain grep over the tree must come back empty.
  const NEEDLES = ['strava' + '.com', 'VITE_' + 'STRAVA'];

  it('has no Strava host literal and no build-time Strava env var in src/', () => {
    const offenders = walk(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return NEEDLES.some((needle) => text.includes(needle));
    });
    expect(offenders).toEqual([]);
  });
});
