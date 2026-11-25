// The PM5 the athlete last connected to, on this phone. Used by Today’s
// Start on PM5 and by the Android list: if this id is still in range, connect
// to it without another tap. The id is the native Bluetooth device id from
// the scan, not the serial printed on the monitor, and never a secret.

export const LAST_PM5_ID_KEY = 'splitiq.pm5.last-id';

export function readLastPm5Id() {
  try {
    const id = window.localStorage.getItem(LAST_PM5_ID_KEY);
    return id || null;
  } catch {
    return null;
  }
}

export function writeLastPm5Id(id) {
  if (!id) return;
  try {
    window.localStorage.setItem(LAST_PM5_ID_KEY, id);
  } catch {
    // Quota or a blocked store — remembering is optional.
  }
}
