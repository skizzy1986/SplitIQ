import { msg } from '@lingui/core/macro';

// What ErgLiveView shows for an error services/pm5Bluetooth.js or
// services/pm5Scan.js throws, keyed by its `code`. The thrown message stays
// English for logs and Sentry. An error without one of these codes (a browser
// DOMException, a native plugin failure) is shown as its own message: those
// words are not ours.
export const PM5_ERROR_MESSAGES = {
  PM5_UNSUPPORTED: msg({
    message:
      'Web Bluetooth is not supported in this browser. Use Chrome or Edge.',
    comment: 'Chrome and Edge are browser names: keep them',
  }),
  PM5_BLE_UNAVAILABLE: msg({
    message:
      "This phone can't use Bluetooth Low Energy, so it can't connect to a PM5.",
    comment:
      'Android app error. Bluetooth Low Energy is a technology name; PM5 is the rowing machine monitor: keep both',
  }),
  PM5_SCAN_FAILED: msg({
    message: "Couldn't start searching for PM5s. Tap Connect to try again.",
    comment:
      'Android app error. Connect is the CONNECT TO PM5 button: match its translation',
  }),
  PM5_BLUETOOTH_OFF: msg({
    message:
      "Bluetooth is off. Turn it on in your phone's settings, then tap Connect again.",
    comment:
      'Android app error. Connect is the CONNECT TO PM5 button: match its translation',
  }),
  PM5_PERMISSION_DENIED: msg({
    message:
      "SplitIQ can't use Bluetooth. In Settings › Apps › SplitIQ › Permissions, allow Nearby devices (Location on Android 11 and older), then tap Connect again.",
    comment:
      "Android app error. Settings › Apps › SplitIQ › Permissions, Nearby devices and Location are Android's own menu and permission names: use the names Android shows in Spanish",
  }),
  PM5_CONNECT_FAILED: msg({
    message:
      "Couldn't connect to that PM5. Check it's awake and not connected to another phone, then tap it again.",
    comment:
      'Shown above the list of nearby PM5 monitors after the chosen one failed to connect; "it" is that monitor in the list',
  }),
};
