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

export function clearPrivateSessionState() {
  generation += 1;
  for (const key of [QUEUE_KEY, DRAFT_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* Unavailable storage cannot be read by the next account either. */
    }
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

export function isolateLegacyPrivateState(owner) {
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
      if (key === DRAFT_KEY && value?.user_id === owner) continue;
      const matching =
        key === QUEUE_KEY && Array.isArray(value)
          ? value.filter((row) => row?.user_id === owner)
          : [];
      if (
        key === QUEUE_KEY &&
        Array.isArray(value) &&
        matching.length === value.length
      )
        continue;
      if (!archiveUnassignedWork(key, raw)) continue;
      if (matching.length)
        window.localStorage.setItem(key, JSON.stringify(matching));
      else window.localStorage.removeItem(key);
    } catch {
      /* Keep unreadable storage untouched; no ownership is inferred. */
    }
  }
}
