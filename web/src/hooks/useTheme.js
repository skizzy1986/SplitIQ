import { createContext, useCallback, useEffect, useState } from 'react';
import {
  DARK_QUERY,
  THEME_KEY,
  THEME_PREFS,
  readThemePref,
  resolveTheme,
  safeStorage,
} from '../utils/themePreference.js';

// Storage events reach other tabs; this event reaches other mounted controls
// in this tab, including when storage is blocked and only memory can change.
const THEME_CHANGE = 'splitiq:theme-change';

export const ThemeContext = createContext(null);

export function useTheme() {
  const [preference, setPreferenceState] = useState(() =>
    readThemePref(safeStorage(window))
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.(DARK_QUERY).matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    const onSystem = (e) => setSystemDark(e.matches);
    const onPreference = (e) => setPreferenceState(e.detail);
    const onStorage = (e) => {
      if (e.key === THEME_KEY || e.key === null) {
        setPreferenceState(readThemePref(safeStorage(window)));
      }
    };
    mq?.addEventListener('change', onSystem);
    window.addEventListener(THEME_CHANGE, onPreference);
    window.addEventListener('storage', onStorage);
    return () => {
      mq?.removeEventListener('change', onSystem);
      window.removeEventListener(THEME_CHANGE, onPreference);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setPreference = useCallback((next) => {
    if (!THEME_PREFS.includes(next)) return;
    setPreferenceState(next);
    try {
      const storage = safeStorage(window);
      if (next === 'system') storage?.removeItem(THEME_KEY);
      else storage?.setItem(THEME_KEY, next);
    } catch {
      // The preference still applies for this visit when persistence is blocked.
    }
    window.dispatchEvent(
      new window.CustomEvent(THEME_CHANGE, { detail: next })
    );
  }, []);

  return {
    preference,
    resolved: resolveTheme(preference, systemDark),
    setPreference,
  };
}
