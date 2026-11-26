import { describe, it, expect } from 'vitest';
import {
  parseRowingCp,
  isSampleSession,
  isGuideDismissed,
  dismissGuide,
  reopenGuide,
  isWelcomeCardDismissed,
  dismissWelcomeCard,
  requestGuideOpen,
  onGuideOpenRequest,
  guideStorageKey,
  SAMPLE_SOURCE,
  MIN_CP,
  MAX_CP,
} from '../firstRunGuide.js';
import { guideFor, GUIDE } from '../../constants/firstRunGuide.js';

describe('parseRowingCp', () => {
  it('accepts a whole number in range', () => {
    expect(parseRowingCp('180')).toBe(180);
    expect(parseRowingCp(' 250 ')).toBe(250);
    expect(parseRowingCp(String(MIN_CP))).toBe(MIN_CP);
    expect(parseRowingCp(String(MAX_CP))).toBe(MAX_CP);
  });

  it('rejects blanks, decimals, and out-of-range values', () => {
    expect(parseRowingCp('')).toBeNull();
    expect(parseRowingCp('12.5')).toBeNull();
    expect(parseRowingCp('-10')).toBeNull();
    expect(parseRowingCp('49')).toBeNull();
    expect(parseRowingCp('501')).toBeNull();
    expect(parseRowingCp('180W')).toBeNull();
  });
});

describe('isSampleSession', () => {
  it('is true only when source is the sample flag', () => {
    expect(SAMPLE_SOURCE).toBe('sample');
    expect(isSampleSession({ source: 'sample' })).toBe(true);
    expect(isSampleSession({ source: 'portal' })).toBe(false);
    expect(isSampleSession({})).toBe(false);
    expect(isSampleSession(null)).toBe(false);
  });
});

describe('guide storage', () => {
  const store = () => {
    const data = new Map();
    return {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
  };

  it('is per account, and skip marks the guide done', () => {
    const s = store();
    expect(isGuideDismissed('user-a', s)).toBe(false);
    expect(isGuideDismissed('', s)).toBe(true);
    dismissGuide('user-a', s);
    expect(isGuideDismissed('user-a', s)).toBe(true);
    expect(isGuideDismissed('user-b', s)).toBe(false);
    expect(s.getItem(guideStorageKey('user-a'))).toBe('done');
    reopenGuide('user-a', s);
    expect(isGuideDismissed('user-a', s)).toBe(false);
  });

  it('keeps the Today welcome card dismiss separate from the walkthrough', () => {
    const s = store();
    dismissWelcomeCard('user-a', s);
    expect(isWelcomeCardDismissed('user-a', s)).toBe(true);
    expect(isGuideDismissed('user-a', s)).toBe(false);
  });

  it('reopens the walkthrough when requested', () => {
    const s = store();
    dismissGuide('user-a', s);
    let hits = 0;
    const stop = onGuideOpenRequest(() => {
      hits += 1;
    });
    requestGuideOpen('user-a', s);
    expect(isGuideDismissed('user-a', s)).toBe(false);
    expect(hits).toBe(1);
    stop();
    requestGuideOpen('user-a', s);
    expect(hits).toBe(1);
  });
});

describe('guide copy', () => {
  it('picks Spanish for es locales and English otherwise', () => {
    expect(guideFor('es').title).toBe(GUIDE.es.title);
    expect(guideFor('es-CO').title).toBe(GUIDE.es.title);
    expect(guideFor('en').title).toBe(GUIDE.en.title);
    expect(guideFor('en-AU').title).toBe(GUIDE.en.title);
    expect(guideFor(undefined).title).toBe(GUIDE.en.title);
  });

  it('covers the main features in both languages, and does not name a person', () => {
    for (const pack of [GUIDE.en, GUIDE.es]) {
      const ids = pack.steps.map((step) => step.id);
      expect(ids).toEqual([
        'welcome',
        'today',
        'cp',
        'plan-log',
        'progress-body',
        'squat',
        'samples',
      ]);
      const blob = JSON.stringify(pack);
      expect(blob).not.toMatch(/Scott/i);
    }
    expect(GUIDE.en.welcomeCard.sampleBadge).toMatch(/sample/i);
    expect(GUIDE.es.welcomeCard.sampleBadge).toMatch(/ejemplo/i);
  });
});
