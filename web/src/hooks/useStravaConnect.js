import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { invalidateSessionQueries } from '../utils/invalidateSessionQueries.js';

// The browser NEVER calls Strava directly. `strava-connect` builds the
// authorize URL server-side (it is the only side that holds the client secret)
// and the whole of the Strava interaction here is one top-level navigation to
// the URL it returns. No fetch, no Strava host literal and no build-time Strava
// env var appears anywhere under src/ — a CSP guarantee depends on that staying
// true, and a test in useStravaConnect.test.jsx enforces it.
//
// Disconnecting deletes Strava-sourced data (#630), so it is two calls: a
// read-only `disconnect_preview` that counts what would go, then `disconnect`
// with `confirm: true`. The confirmation itself is the panel's inline region.

const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

async function invokeConnect(body) {
  const { data, error } = await supabase.functions.invoke('strava-connect', {
    body,
  });
  if (error) throw error;
  return data;
}

export function useStravaConnect() {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationKey: ['strava', 'connect', 'start'],
    mutationFn: async () => {
      const data = await invokeConnect({ action: 'start' });
      const authorizeUrl = data?.authorize_url;
      if (!authorizeUrl) {
        throw new Error('strava-connect returned no authorize url');
      }
      return authorizeUrl;
    },
    onSuccess: (authorizeUrl) => {
      window.location.href = authorizeUrl;
    },
  });

  // A preview with no counts must not render as "nothing will be removed", so
  // a malformed body is an error, not zeros.
  const preview = useMutation({
    mutationKey: ['strava', 'connect', 'disconnect-preview'],
    mutationFn: async () => {
      const data = await invokeConnect({ action: 'disconnect_preview' });
      const p = data?.preview;
      if (
        !p ||
        ![p.toDelete, p.toKeep, p.toRestore].every((n) => Number.isInteger(n))
      ) {
        throw new Error('strava-connect returned no disconnect preview');
      }
      return { toDelete: p.toDelete, toKeep: p.toKeep, toRestore: p.toRestore };
    },
  });

  // Any 2xx means the purge committed, so it resolves even if a count is
  // missing: throwing here would show "Nothing was changed" over a change.
  const disconnect = useMutation({
    mutationKey: ['strava', 'connect', 'disconnect'],
    mutationFn: async () => {
      const data = await invokeConnect({ action: 'disconnect', confirm: true });
      return {
        removed: count(data?.removed),
        kept: count(data?.kept),
        restored: count(data?.restored),
        revocation: data?.revocation ?? 'failed',
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strava', 'connection'] });
      // Deleted and stripped sessions change every session reader and the
      // load model (tss-history) built from them.
      invalidateSessionQueries(queryClient);
    },
  });

  return { start, preview, disconnect };
}
