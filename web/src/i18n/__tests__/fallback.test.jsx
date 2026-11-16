import { i18n } from '@lingui/core';
import { messages as en } from '../../locales/en.po';
import { messages as es } from '../../locales/es.po';
import { messages as viewsEn } from '../../locales/views/en.po';
import { messages as viewsEs } from '../../locales/views/es.po';
import {
  ensureLocale,
  registerCatalogs,
  __resetLocaleCacheForTests,
} from '../locale.js';

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

// Production descriptors are id-only (the plugin strips `message`), so the
// fallback that matters is the one that needs no source text in the code.
const idOnly = (id) => ({ id });

beforeEach(() => __resetLocaleCacheForTests());

describe('the English fallback', () => {
  it('renders English, never an id, for a message the Spanish catalog lacks', async () => {
    const [missingId] = Object.keys(en);
    const partial = { ...es };
    delete partial[missingId];
    registerCatalogs('partial', {
      source: en,
      loaders: { es: () => Promise.resolve({ messages: partial }) },
    });

    expect(await ensureLocale('es', 'partial')).toBe(true);
    i18n.activate('es');
    const englishText = (() => {
      i18n.activate('en');
      const text = i18n._(idOnly(missingId));
      i18n.activate('es');
      return text;
    })();

    expect(i18n._(idOnly(missingId))).toBe(englishText);
    expect(i18n._(idOnly(missingId))).not.toBe(missingId);
  });

  it('ships a Spanish catalog with every English id, each translated', () => {
    expect(Object.keys({ ...en, ...viewsEn }).length).toBeGreaterThan(50);
    for (const [source, translated] of [
      [en, es],
      [viewsEn, viewsEs],
    ]) {
      const ids = Object.keys(source);
      expect(ids.length).toBeGreaterThan(0);
      expect(Object.keys(translated).sort()).toEqual(ids.sort());
      i18n.load('es', translated);
      i18n.activate('es');
      for (const id of ids) {
        const text = i18n._(idOnly(id), { count: 2, 0: 'x' });
        expect(text, id).toBeTruthy();
        expect(text, id).not.toBe(id);
      }
    }
  });
});
