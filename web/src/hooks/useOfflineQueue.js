import { useState, useEffect } from 'react';
import { useSessionOwner } from './useSessionOwner.js';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { supabase } from '../supabaseClient';
import { toLogDate } from '../utils/dateFormat.js';
import { invalidateSessionQueries } from '../utils/invalidateSessionQueries.js';
import { captureError } from '../utils/sentry.js';

import {
  QUEUE_KEY,
  privateSessionGeneration,
} from '../utils/privateSessionState.js';

// Rows queued by older builds carry column names that do not exist on
// `sessions` (`watts`, `distance`) and ISO/numeric shapes the table rejects, so
// every drain failed forever. Normalising on read means a stale queue heals
// itself the first time it is drained, without a migration.
export function normalizeQueuedSession(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };

  if ('watts' in out) {
    if (!('avg_watts' in out)) out.avg_watts = out.watts;
    delete out.watts;
  }
  if ('distance' in out) {
    if (!('distance_m' in out)) out.distance_m = out.distance;
    delete out.distance;
  }
  if (out.date) out.date = toLogDate(out.date);
  if (typeof out.duration === 'number') out.duration = String(out.duration);

  return out;
}

function readQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(normalizeQueuedSession) : [];
  } catch {
    return [];
  }
}

// Postgres unique_violation on sessions' UNIQUE(user_id, date, label): this
// owner already has the row, so a retry can never succeed — treat it as
// delivered. The key is per owner (#790); another account's row cannot cause it.
function isDuplicate(error) {
  return error?.code === '23505' || /duplicate key/i.test(error?.message || '');
}

function writeQueue(items) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function enqueueSession(session) {
  const q = readQueue();
  q.push({
    ...session,
    _queuedAt: Date.now(),
    _queueId: window.crypto.randomUUID(),
  });
  writeQueue(q);
}

// Both the `online` listener and the mount-time sync can fire in the same tick;
// without this guard each row is inserted twice.
let drainingGeneration = null;

async function drainQueue(ownerId) {
  if (!ownerId) return 0;
  const generation = privateSessionGeneration();
  if (drainingGeneration === generation) return 0;
  drainingGeneration = generation;
  try {
    const q = readQueue().map((row) => ({
      ...row,
      _queueId: row._queueId ?? window.crypto.randomUUID(),
    }));
    if (q.length === 0) return 0;
    // Persist legacy IDs before awaiting anything, so appended work and retries
    // can be reconciled by identity rather than overwriting a stale snapshot.
    writeQueue(q);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (generation !== privateSessionGeneration() || user?.id !== ownerId)
      return 0;
    const delivered = new Set();
    for (const session of q) {
      if (generation !== privateSessionGeneration()) return 0;
      // Unknown ownership is never assigned to whoever happens to sign in next.
      // AuthGate separately quarantines legacy unassigned/mismatched local work.
      if (session.user_id !== user.id) continue;
      const { _queuedAt, _queueId, ...row } = session;
      const { error } = await supabase.from('sessions').insert(row);
      if (generation !== privateSessionGeneration()) return 0;
      if (error && !isDuplicate(error)) {
        captureError(error, { source: 'useOfflineQueue', op: 'drainQueue' });
      } else {
        delivered.add(session._queueId);
      }
    }
    const remaining = readQueue().filter((row) => !delivered.has(row._queueId));
    writeQueue(remaining);
    return delivered.size;
  } finally {
    if (drainingGeneration === generation) drainingGeneration = null;
  }
}

export function useOfflineQueue() {
  const ownerId = useSessionOwner();
  const countPending = () =>
    ownerId ? readQueue().filter((row) => row?.user_id === ownerId).length : 0;
  const [pending, setPending] = useState(countPending);
  const [generation] = useState(privateSessionGeneration);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    const sync = async (connected) => {
      if (active && connected && generation === privateSessionGeneration()) {
        const synced = await drainQueue(ownerId);
        if (active && generation === privateSessionGeneration() && synced > 0) {
          setPending(
            readQueue().filter((row) => row?.user_id === ownerId).length
          );
          // Once after the loop, not per row: N×3 refetch triggers would race
          // the inserts still in flight.
          invalidateSessionQueries(queryClient);
        }
      }
    };

    if (Capacitor.isNativePlatform()) {
      let networkHandle;
      Network.addListener('networkStatusChange', ({ connected }) =>
        sync(connected)
      ).then((h) => {
        if (active) networkHandle = h;
        else h.remove();
      });
      Network.getStatus().then(({ connected }) => sync(connected));
      return () => {
        active = false;
        networkHandle?.remove();
      };
    } else {
      const webSync = () => sync(navigator.onLine);
      window.addEventListener('online', webSync);
      webSync();
      return () => {
        active = false;
        window.removeEventListener('online', webSync);
      };
    }
  }, [queryClient, generation, ownerId]);

  function addToQueue(session) {
    if (generation !== privateSessionGeneration()) return false;
    const userId = ownerId;
    if (!userId || (session.user_id && session.user_id !== userId))
      return false;
    enqueueSession({ ...session, user_id: userId });
    setPending(readQueue().filter((row) => row?.user_id === ownerId).length);
    return true;
  }

  return { pending, addToQueue };
}
