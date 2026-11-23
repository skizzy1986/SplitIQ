import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clientPlatform,
  currentScreen,
  readClientPlatform,
} from '../reportContext.js';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

describe('clientPlatform', () => {
  it('reports android on the native app, ahead of a standalone display', () => {
    expect(clientPlatform({ native: true, displayMode: 'standalone' })).toBe(
      'android'
    );
  });

  it('reports pwa for a standalone display or an iOS home-screen flag', () => {
    expect(clientPlatform({ displayMode: 'standalone' })).toBe('pwa');
    expect(clientPlatform({ iosStandalone: true })).toBe('pwa');
  });

  it('reports web otherwise', () => {
    expect(clientPlatform()).toBe('web');
    expect(clientPlatform({ displayMode: 'browser' })).toBe('web');
  });
});

describe('currentScreen', () => {
  it('uses the hash path and drops the query string', () => {
    expect(
      currentScreen({ hash: '#/settings?code=secret', pathname: '/' })
    ).toBe('/settings');
  });

  it('falls back to the pathname when there is no hash', () => {
    expect(currentScreen({ hash: '', pathname: '/squat' })).toBe('/squat');
    expect(currentScreen({})).toBe('/');
  });
});

describe('readClientPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a standalone display as pwa', () => {
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query === '(display-mode: standalone)',
    }));
    expect(readClientPlatform()).toBe('pwa');
  });

  it('reads a plain browser as web when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(readClientPlatform()).toBe('web');
  });
});
