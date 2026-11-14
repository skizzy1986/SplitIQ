import {
  LANG_KEY,
  LANG_TAG,
  LANG_UI,
  OFFLINE_TEXT,
  ROOT_ERROR_TEXT,
  detectLang,
  initialLang,
  readLangPref,
  readStoredLang,
  writeLangPref,
} from '../lang.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
};

const throwingStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('the language preference', () => {
  afterEach(() => window.localStorage.clear());

  it('is one product-neutral key shared by the dashboard and /squat', () => {
    expect(LANG_KEY).toBe('splitiq.lang');
  });

  it.each([
    [{ languages: ['es-CO', 'en'], language: 'es-CO' }, 'es'],
    [{ languages: ['es'] }, 'es'],
    [{ languages: ['ES-mx'] }, 'es'],
    [{ languages: ['es-419'] }, 'es'],
    [{ languages: ['en-AU', 'es'] }, 'en'],
    [{ languages: ['fr-FR', 'es'] }, 'en'],
    [{ languages: ['est'] }, 'en'],
    [{ languages: [], language: 'es-AR' }, 'es'],
    [{ language: 'es' }, 'es'],
    [{ language: 'pt-BR' }, 'en'],
    [{}, 'en'],
    [null, 'en'],
  ])(
    'detectLang(%j) is %s: only the top-ranked language decides',
    (nav, lang) => {
      expect(detectLang(nav)).toBe(lang);
    }
  );

  it('detectLang never throws on a hostile navigator', () => {
    const nav = {
      get languages() {
        throw new Error('nope');
      },
    };
    expect(detectLang(nav)).toBe('en');
  });

  it('a first visit follows the device language (B5, B6)', () => {
    expect(
      initialLang({
        localStorage: memoryStorage(),
        navigator: { languages: ['es-CO'] },
      })
    ).toBe('es');
    expect(
      initialLang({
        localStorage: memoryStorage(),
        navigator: { languages: ['de-DE'] },
      })
    ).toBe('en');
    expect(initialLang({ localStorage: memoryStorage() })).toBe('en');
  });

  it('a stored choice always wins over the device language (B7)', () => {
    const es = { languages: ['es-CO'] };
    const en = { languages: ['en-US'] };
    expect(
      initialLang({
        localStorage: memoryStorage({ [LANG_KEY]: 'en' }),
        navigator: es,
      })
    ).toBe('en');
    expect(
      initialLang({
        localStorage: memoryStorage({ [LANG_KEY]: 'es' }),
        navigator: en,
      })
    ).toBe('es');
  });

  it('an unknown stored value is no choice, so detection applies', () => {
    const storage = memoryStorage({ [LANG_KEY]: 'fr' });
    expect(readStoredLang(storage)).toBeNull();
    expect(
      initialLang({ localStorage: storage, navigator: { languages: ['es'] } })
    ).toBe('es');
  });

  it('detection never writes the stored preference (B8)', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    initialLang({ localStorage: storage, navigator: { languages: ['es'] } });
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.data).toEqual({});
  });

  it('storage blocked on a Spanish device: Spanish, without throwing', () => {
    const win = {
      get localStorage() {
        throw new Error('SecurityError');
      },
      navigator: { languages: ['es-CO'] },
    };
    expect(initialLang(win)).toBe('es');
    expect(
      initialLang({
        localStorage: throwingStorage,
        navigator: { languages: ['es'] },
      })
    ).toBe('es');
  });

  it('reads a stored choice and rejects anything it does not know', () => {
    expect(readLangPref(memoryStorage({ [LANG_KEY]: 'es' }))).toBe('es');
    expect(readLangPref(memoryStorage({ [LANG_KEY]: 'en' }))).toBe('en');
    expect(readLangPref(memoryStorage({ [LANG_KEY]: 'es-CO' }))).toBe('en');
    expect(readLangPref(memoryStorage({ [LANG_KEY]: 'fr' }))).toBe('en');
    expect(readLangPref(null)).toBe('en');
  });

  it('falls back to English, without throwing, when storage is blocked', () => {
    expect(readLangPref(throwingStorage)).toBe('en');
    const win = {
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    expect(initialLang(win)).toBe('en');
    expect(writeLangPref('es', win)).toBe(false);
    expect(writeLangPref('es', { localStorage: throwingStorage })).toBe(false);
    expect(initialLang(undefined)).toBe('en');
  });

  it('persists a choice for the next load', () => {
    expect(writeLangPref('es', window)).toBe(true);
    expect(window.localStorage.getItem(LANG_KEY)).toBe('es');
    expect(initialLang(window)).toBe('es');
  });

  it('tags Spanish as es-CO', () => {
    expect(LANG_TAG).toEqual({ en: 'en', es: 'es-CO' });
  });

  it('has both languages for every pre-chunk string', () => {
    for (const table of [
      OFFLINE_TEXT,
      ROOT_ERROR_TEXT.heading,
      ROOT_ERROR_TEXT.body,
      ROOT_ERROR_TEXT.retry,
      LANG_UI.label,
      LANG_UI.native,
      LANG_UI.describe,
      LANG_UI.unavailable,
    ]) {
      expect(table.en).toBeTruthy();
      expect(table.es).toBeTruthy();
    }
  });

  it('names each language in its own language', () => {
    expect(LANG_UI.native).toEqual({ en: 'English', es: 'Español' });
  });
});
