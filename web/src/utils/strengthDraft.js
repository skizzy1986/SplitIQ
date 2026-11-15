import { DRAFT_KEY } from '../constants/privateStorageKeys.js';
import {
  archiveUnassignedWork,
  privateSessionGeneration,
} from './privateSessionState.js';
export { DRAFT_KEY } from '../constants/privateStorageKeys.js';

export function saveDraft(active) {
  if (!active) return;
  try {
    const existing = localStorage.getItem(DRAFT_KEY);
    if (existing) {
      let previous;
      try {
        previous = JSON.parse(existing);
      } catch {
        previous = null;
      }
      if (!previous?.user_id && !archiveUnassignedWork(DRAFT_KEY, existing))
        return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(active));
  } catch {
    // QuotaExceededError or SecurityError — best-effort, silently ignore
  }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.id || !p.label || !Array.isArray(p.exercises)) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return p;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

// A late save/discard callback from an unmounted account must not replace or
// remove the next account's draft. Capture this store once when the logger mounts.
export function sessionDraftStore() {
  const generation = privateSessionGeneration();
  const current = () => generation === privateSessionGeneration();
  return {
    saveDraft: (active) => {
      if (current()) saveDraft(active);
    },
    loadDraft: () => (current() ? loadDraft() : null),
    clearDraft: () => {
      if (current()) clearDraft();
    },
  };
}
