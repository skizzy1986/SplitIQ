// Is this the testers build? (#791, #793)
//
// The testers site and the testers app talk to the SplitIQ dev project, never
// to the owner's own. Two signals say so, and either is enough:
//   1. VITE_TESTERS_BUILD=true, an explicit flag for a build that wants it;
//   2. VITE_SUPABASE_URL is the dev project, which is what the Preview
//      deployments and the testers APK are built with (#716, #794).
// The second one exists so the answer cannot be wrong by omission: a build that
// points at dev is a testers build even if nobody remembered to set the flag,
// and a build that points anywhere else is not. Health and Strava screens are
// hidden on a testers build, and the invite sign-up link appears on it.
//
// The project ref below is public (it is in every dev URL); it is not a key.
export const DEV_PROJECT_REF = 'niytwgtsclzuhyggvbhd';

export function isTestersBuild(env = import.meta.env) {
  if (String(env?.VITE_TESTERS_BUILD ?? '').toLowerCase() === 'true') {
    return true;
  }
  try {
    const host = new URL(String(env?.VITE_SUPABASE_URL ?? '')).hostname;
    return host.split('.')[0] === DEV_PROJECT_REF;
  } catch {
    return false;
  }
}
