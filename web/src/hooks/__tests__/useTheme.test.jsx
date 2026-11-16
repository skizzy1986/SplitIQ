import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from '../useTheme.js';

let mq;
beforeEach(() => {
  localStorage.clear();
  mq = new window.EventTarget();
  mq.matches = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mq)
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function system(dark) {
  mq.matches = dark;
  const event = new window.Event('change');
  event.matches = dark;
  act(() => mq.dispatchEvent(event));
}

describe('shared theme preference', () => {
  it('defaults to Auto, follows OS changes, and cleans subscriptions in StrictMode', () => {
    const add = vi.spyOn(mq, 'addEventListener');
    const remove = vi.spyOn(mq, 'removeEventListener');
    const { result, unmount } = renderHook(() => useTheme(), {
      wrapper: StrictMode,
    });
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('light');
    system(true);
    expect(result.current.resolved).toBe('dark');
    unmount();
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });

  it('reads the stored choice and keeps explicit modes independent of the OS', () => {
    localStorage.setItem('splitiq.theme', 'light');
    mq.matches = true;
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    system(false);
    system(true);
    expect(result.current.resolved).toBe('light');
  });

  it('shares choices between mounted consumers and persists across remounts', () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());
    act(() => first.result.current.setPreference('dark'));
    expect(second.result.current.resolved).toBe('dark');
    expect(localStorage.getItem('splitiq.theme')).toBe('dark');
    first.unmount();
    const third = renderHook(() => useTheme());
    expect(third.result.current.resolved).toBe('dark');
    act(() => third.result.current.setPreference('system'));
    expect(localStorage.getItem('splitiq.theme')).toBeNull();
    expect(second.result.current.preference).toBe('system');
    system(true);
    expect(second.result.current.resolved).toBe('dark');
  });

  it('ignores unsupported choices and treats corrupt persisted values as Auto', () => {
    localStorage.setItem('splitiq.theme', 'neon');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('neon'));
    expect(result.current.preference).toBe('system');
    expect(localStorage.getItem('splitiq.theme')).toBe('neon');
  });

  it('updates when another tab changes or clears preferences', () => {
    const { result } = renderHook(() => useTheme());
    localStorage.setItem('splitiq.theme', 'dark');
    act(() =>
      window.dispatchEvent(
        new window.StorageEvent('storage', { key: 'splitiq.theme' })
      )
    );
    expect(result.current.resolved).toBe('dark');
    localStorage.clear();
    act(() =>
      window.dispatchEvent(new window.StorageEvent('storage', { key: null }))
    );
    expect(result.current.preference).toBe('system');
  });

  it('works when reading localStorage itself is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());
    act(() => first.result.current.setPreference('dark'));
    expect(first.result.current.resolved).toBe('dark');
    expect(second.result.current.resolved).toBe('dark');
  });

  it('keeps working if writes fail or matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    act(() => result.current.setPreference('dark'));
    expect(result.current.resolved).toBe('dark');
  });
});
