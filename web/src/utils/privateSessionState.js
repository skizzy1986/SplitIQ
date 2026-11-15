import {
  DRAFT_KEY,
  QUEUE_KEY,
  OWNER_KEY,
  UNASSIGNED_KEY,
} from '../constants/privateStorageKeys.js';
export { QUEUE_KEY, UNASSIGNED_KEY } from '../constants/privateStorageKeys.js';
let generation = 0;

export const privateSessionGeneration = () => generation;

export function storedSessionOwner() {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  } // Storage can be unavailable in private contexts.
}

export function rememberSessionOwner(owner) {
  try {
    if (owner) window.localStorage.setItem(OWNER_KEY, owner);
    else window.localStorage.removeItem(OWNER_KEY);
  } catch {
    /* The in-memory auth boundary still applies when storage is blocked. */
  }
}

// Retain ownerless legacy work for explicit recovery, never assign it to whoever
// signs in first after an upgrade. If storage is full, leave the original intact;
// the draft loader and replay queue also reject records with unknown ownership.
export function archiveUnassignedWork(key, raw) {
  try {
    const previous = JSON.parse(
      window.localStorage.getItem(UNASSIGNED_KEY) || '[]'
    );
    if (!Array.isArray(previous)) return false;
    window.localStorage.setItem(
      UNASSIGNED_KEY,
      JSON.stringify([
        ...previous,
        { key, raw, archivedAt: new Date().toISOString() },
      ])
    );
    return true;
  } catch {
    return false;
  }
}

// An account boundary (sign-in, sign-out, switch, or first boot after an upgrade).
// Late callbacks from the previous account become stale through the generation.
// Owner-tagged queue rows and drafts are kept: they may be unsynced workouts, and
// replay and the logger only ever act on the signed-in owner's records. Deleting
// them on sign-out or session expiry would lose training data. The trade-off is
// that another account on the same device leaves them in storage, not on screen.
// Ownerless legacy work is quarantined, never assigned to whoever signs in next.
export function startPrivateSession() {
  generation += 1;
  for (const key of [QUEUE_KEY, DRAFT_KEY]) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        value = null;
      }
      if (key === DRAFT_KEY && value?.user_id) continue;
      const owned =
        key === QUEUE_KEY && Array.isArray(value)
          ? value.filter((row) => row?.user_id)
          : [];
      if (
        key === QUEUE_KEY &&
        Array.isArray(value) &&
        owned.length === value.length
      )
        continue;
      if (!archiveUnassignedWork(key, raw)) continue;
      if (owned.length) window.localStorage.setItem(key, JSON.stringify(owned));
      else window.localStorage.removeItem(key);
    } catch {
      /* Keep unreadable storage untouched; no ownership is inferred. */
    }
  }
}
