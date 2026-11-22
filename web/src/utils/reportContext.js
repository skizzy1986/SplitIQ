import { Capacitor } from '@capacitor/core';

// What the bug report is allowed to say about the device. Three values, so a
// client cannot put an email or a free-text label in the platform field.
export function clientPlatform({
  native = false,
  displayMode = '',
  iosStandalone = false,
} = {}) {
  if (native) return 'android';
  if (displayMode === 'standalone' || iosStandalone) return 'pwa';
  return 'web';
}

export function readClientPlatform() {
  let native = false;
  try {
    native = Capacitor.isNativePlatform() === true;
  } catch {
    // Expected non-event: no Capacitor bridge (a plain browser, or jsdom).
    // native stays false, so the report still sends as web or PWA.
  }
  const displayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : '';
  const iosStandalone = navigator.standalone === true;
  return clientPlatform({ native, displayMode, iosStandalone });
}

// The screen the person was on. Hash routes are the app's own navigation.
// Query strings are dropped: an OAuth callback can leave a code there, and
// that must not be copied into Slack.
export function currentScreen(loc) {
  const hash = typeof loc?.hash === 'string' ? loc.hash : '';
  const fromHash = hash.replace(/^#/, '').split('?')[0];
  if (fromHash) return fromHash;
  const path =
    typeof loc?.pathname === 'string' ? loc.pathname.split('?')[0] : '';
  return path || '/';
}
