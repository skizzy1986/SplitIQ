import { Capacitor } from '@capacitor/core';
import { clientPlatform } from './clientPlatform.js';

export const REPORT_FUNCTION = 'report-problem';

export function currentScreen(loc) {
  const hash = loc?.hash ?? '';
  if (hash && hash !== '#' && hash !== '#/') return hash;
  return loc?.pathname || '/';
}

export function readPlatform() {
  const standalone =
    (typeof navigator !== 'undefined' && navigator.standalone === true) ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches === true);
  return clientPlatform({
    native: Capacitor.isNativePlatform(),
    standalone,
  });
}

// The body carries the user id the session already has. It does not carry the
// email. The function ignores this id and uses the verified bearer instead.
export function reportBody({ what, steps, version, route, platform, userId }) {
  return {
    what: what.trim(),
    steps: (steps ?? '').trim(),
    version,
    route,
    platform,
    userId,
  };
}

export async function sendProblemReport(supabase, fields) {
  const body = reportBody(fields);
  const { error } = await supabase.functions.invoke(REPORT_FUNCTION, { body });
  if (error) {
    const status =
      typeof error.context?.status === 'number' ? error.context.status : null;
    const err = new Error(status === 429 ? 'rate limited' : 'delivery failed');
    err.status = status;
    throw err;
  }
  return body;
}
