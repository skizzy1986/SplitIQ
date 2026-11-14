// The language preference, readable before any product chunk has loaded. Plain
// data and functions, no Lingui: RouteRoot's offline message and the root error
// fallback render from here, and both sit in front of the chunk that would
// bring Lingui in. One key serves the dashboard and /squat, so a switch in
// either is honoured by the other on its next load.

import { safeStorage } from '../utils/squatTheme.js';

export const LANG_KEY = 'splitiq.lang';
export const LANGS = ['en', 'es'];
export const DEFAULT_LANG = 'en';
export const LANG_TAG = { en: 'en', es: 'es-CO' };

// The language control is shared by both products, so its few words live here
// rather than in either product's catalog.
export const LANG_UI = {
  label: { en: 'Language', es: 'Idioma' },
  native: { en: 'English', es: 'Español' },
  // In the current language, describing the switch to the other one.
  describe: {
    en: 'Switch the app to Spanish',
    es: 'Cambia la app a inglés',
  },
  // Shown in both languages: a device-language visitor may not read English.
  // Reload, not retry: a browser may keep a failed dynamic import for the life
  // of the page, so choosing Spanish again without a reload can fail the same way.
  unavailable: {
    en: 'Spanish could not be loaded. Check your connection and reload the page.',
    es: 'No se pudo cargar el español. Revisa tu conexión y vuelve a cargar la página.',
  },
};

// Shown before the squat tool's chunk exists (RouteRoot).
export const OFFLINE_TEXT = {
  en: 'The squat tool needs a connection the first time. Reconnect and reload.',
  es: 'La herramienta de sentadilla necesita conexión la primera vez. Conéctate y vuelve a cargar.',
};

// The root error fallback renders outside every provider, possibly before the
// dashboard's catalog has loaded, so it cannot go through Lingui.
export const ROOT_ERROR_TEXT = {
  heading: { en: 'SOMETHING WENT WRONG', es: 'ALGO SALIÓ MAL' },
  body: {
    en: 'The error has been reported. Try again, and if it keeps happening reload the app.',
    es: 'Ya reportamos el error. Inténtalo de nuevo y, si sigue pasando, vuelve a cargar la app.',
  },
  retry: { en: 'TRY AGAIN', es: 'INTÉNTALO DE NUEVO' },
};

export function readStoredLang(storage) {
  try {
    const v = storage?.getItem(LANG_KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    // Storage blocked (private mode, sandboxed iframe): an expected non-event,
    // not an operational error, so nothing is reported.
    return null;
  }
}

export const readLangPref = (storage) =>
  readStoredLang(storage) ?? DEFAULT_LANG;

// Only the top-ranked language decides: ['fr-FR', 'es'] is a French visitor.
export function detectLang(nav = globalThis.navigator) {
  try {
    const tag = String(nav?.languages?.[0] ?? nav?.language ?? '');
    return tag.toLowerCase().split('-')[0] === 'es' ? 'es' : DEFAULT_LANG;
  } catch {
    // A hostile or stubbed navigator: English, as with no navigator at all.
    return DEFAULT_LANG;
  }
}

// Device language on a first visit (Gate 1, 2026-11-14, reversing SPEC AC 3).
// Detection is never written back, so a stored choice is always a choice.
export function initialLang(win = globalThis.window) {
  return win
    ? (readStoredLang(safeStorage(win)) ?? detectLang(win.navigator ?? null))
    : DEFAULT_LANG;
}

export function writeLangPref(lang, win = globalThis.window) {
  try {
    const storage = safeStorage(win);
    if (!storage) return false;
    storage.setItem(LANG_KEY, lang);
    return true;
  } catch {
    // Blocked or full storage: the choice holds for this visit only. Expected,
    // so not reported.
    return false;
  }
}
