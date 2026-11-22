import { describe, it, expect } from 'vitest';
import { clientPlatform } from '../clientPlatform.js';

describe('clientPlatform', () => {
  it('reports the browser', () => {
    expect(clientPlatform()).toBe('web');
  });

  it('reports an installed PWA', () => {
    expect(clientPlatform({ standalone: true })).toBe('pwa');
  });

  it('reports the Android app even when the WebView looks standalone', () => {
    expect(clientPlatform({ native: true, standalone: true })).toBe('android');
  });
});
