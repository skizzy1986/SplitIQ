import { msg } from '@lingui/core/macro';

// What ErgLiveView shows for an error services/pm5Bluetooth.js throws, keyed
// by its `code`. The thrown message stays English for logs and Sentry. An
// error without one of these codes (a browser DOMException, a native plugin
// failure) is shown as its own message: those words are not ours.
export const PM5_ERROR_MESSAGES = {
  PM5_UNSUPPORTED: msg({
    message:
      'Web Bluetooth is not supported in this browser. Use Chrome or Edge.',
    comment: 'Chrome and Edge are browser names: keep them',
  }),
};
