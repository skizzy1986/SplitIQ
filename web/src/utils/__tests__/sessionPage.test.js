import {
  SESSION_ID_RE,
  canOpenSessionPage,
  focusSessionLink,
  formatClock,
  httpsUrlOrNull,
  parseSessionId,
  recentHrBaseline,
  recentPowerBaseline,
  sessionHref,
  sessionIdFromHash,
  sessionSport,
  storedSummary,
} from '../sessionPage.js';
import { wattsToPace500 } from '../pace.js';

describe('session ids and hrefs', () => {
  it('accepts positive integers without a leading zero', () => {
    expect(SESSION_ID_RE.test('1')).toBe(true);
    expect(SESSION_ID_RE.test('0')).toBe(false);
    expect(SESSION_ID_RE.test('01')).toBe(false);
    expect(SESSION_ID_RE.test('1.5')).toBe(false);
    expect(parseSessionId('42')).toBe(42);
    expect(parseSessionId('9999999999999999')).toBeNull();
    expect(parseSessionId(null)).toBeNull();
  });

  it('builds and reads #/session/<id>', () => {
    expect(sessionHref(42)).toBe('#/session/42');
    expect(sessionIdFromHash(sessionHref(42))).toBe(42);
    expect(sessionIdFromHash('#/session/42/')).toBe(42);
    expect(sessionIdFromHash('#/session/abc')).toBeNull();
    expect(sessionIdFromHash('#/session/42/x')).toBeNull();
    expect(sessionIdFromHash('#/progress')).toBeNull();
    expect(sessionIdFromHash('')).toBeNull();
  });
});

describe('sessionSport', () => {
  it.each([
    ['erg', 'erg'],
    ['Erg', 'erg'],
    ['cycling', 'cycling'],
    ['bike', 'cycling'],
    ['ride', 'cycling'],
    ['strength', null],
    ['mobility', null],
    [null, null],
  ])('%s -> %s', (type, sport) => {
    expect(sessionSport(type)).toBe(sport);
  });
});

describe('canOpenSessionPage', () => {
  it('opens a completed erg or cycling session with a valid id', () => {
    expect(
      canOpenSessionPage({ _isErg: true, status: 'completed', _id: 3 })
    ).toBe(true);
    expect(
      canOpenSessionPage({ _isCycling: true, status: 'actual', _id: 4 })
    ).toBe(true);
    expect(canOpenSessionPage({ type: 'erg', status: 'logged', id: 5 })).toBe(
      true
    );
    expect(
      canOpenSessionPage({ type: 'bike', status: 'completed', id: 6 })
    ).toBe(true);
  });

  it('does not open planned, cancelled, strength, or id-less rows', () => {
    expect(canOpenSessionPage({ type: 'erg', status: 'planned', id: 1 })).toBe(
      false
    );
    expect(
      canOpenSessionPage({ type: 'erg', status: 'cancelled', id: 1 })
    ).toBe(false);
    expect(
      canOpenSessionPage({ type: 'strength', status: 'completed', id: 1 })
    ).toBe(false);
    expect(canOpenSessionPage({ type: 'erg', status: 'completed' })).toBe(
      false
    );
    expect(canOpenSessionPage(null)).toBe(false);
  });
});

describe('recentPowerBaseline', () => {
  const row = (date_iso, avg_watts, type = 'erg', status = 'completed') => ({
    date_iso,
    avg_watts,
    type,
    status,
  });

  it('averages completed same-sport sessions with power in the prior 30 days', () => {
    const rows = [
      row('2026-11-10', 180),
      row('2026-11-01', 170),
      row('2026-10-20', 160),
      row('2026-11-15', 999), // the session's own day: excluded
      row('2026-10-01', 100), // outside the window
      row('2026-11-05', 300, 'cycling'),
      row('2026-11-06', 400, 'erg', 'planned'),
      row('2026-11-07', null),
    ];
    expect(recentPowerBaseline(rows, 'erg', '2026-11-15')).toEqual({
      meanWatts: 170,
      count: 3,
    });
  });

  it('reads the text date when date_iso is absent', () => {
    const rows = [
      { date: '11/10/26', avg_watts: 150, type: 'erg', status: 'completed' },
      { date: '11/11/26', avg_watts: 160, type: 'erg', status: 'completed' },
      { date: '11/12/26', avg_watts: 170, type: 'erg', status: 'completed' },
    ];
    expect(recentPowerBaseline(rows, 'erg', '2026-11-15')).toEqual({
      meanWatts: 160,
      count: 3,
    });
  });

  it('is null with fewer than three sessions', () => {
    expect(
      recentPowerBaseline(
        [row('2026-11-10', 180), row('2026-11-01', 170)],
        'erg',
        '2026-11-15'
      )
    ).toBeNull();
    expect(recentPowerBaseline([], 'erg', '')).toBeNull();
  });
});

describe('recentHrBaseline', () => {
  const row = (date_iso, avg_hr, type = 'cycling', status = 'completed') => ({
    date_iso,
    avg_hr,
    type,
    status,
  });

  it('averages heart rate by the same rule as power', () => {
    const rows = [
      row('2026-11-10', 150),
      row('2026-11-01', 140),
      row('2026-10-20', 145),
      row('2026-11-15', 199), // the session's own day: excluded
      row('2026-10-01', 100), // outside the window
      row('2026-11-05', 170, 'erg'),
      row('2026-11-06', 170, 'cycling', 'planned'),
      row('2026-11-07', 0),
    ];
    expect(recentHrBaseline(rows, 'cycling', '2026-11-15')).toEqual({
      meanHr: 145,
      count: 3,
    });
  });

  it('is null with fewer than three sessions', () => {
    expect(
      recentHrBaseline(
        [row('2026-11-10', 150), row('2026-11-01', 140)],
        'cycling',
        '2026-11-15'
      )
    ).toBeNull();
  });
});

describe('storedSummary', () => {
  it('derives rowing pace from distance and time, then from power', () => {
    expect(
      storedSummary({ duration: '40:00', distance_m: 10000 }, 'erg').pace500
    ).toBeCloseTo(120);
    expect(
      storedSummary({ duration: '40:00', avg_watts: 200 }, 'erg').pace500
    ).toBeCloseTo(wattsToPace500(200));
  });

  it('derives cycling speed and leaves absent values null', () => {
    const s = storedSummary(
      { duration: '60:00', distance_m: 30000 },
      'cycling'
    );
    expect(s.speedKmh).toBeCloseTo(30);
    expect(s.avgWatts).toBeNull();
    expect(s.avgHr).toBeNull();
    expect(s.pace500).toBeNull();
    expect(storedSummary({}, 'erg')).toMatchObject({
      minutes: null,
      distanceM: null,
      srpe: null,
    });
  });
});

describe('focusSessionLink', () => {
  it('focuses the link now, or within a few frames once it mounts', () => {
    const frames = [];
    const win = {
      document,
      requestAnimationFrame: (fn) => frames.push(fn),
    };
    focusSessionLink(31, { win });
    expect(frames).toHaveLength(1);
    const a = document.createElement('a');
    a.setAttribute('href', '#/session/31');
    a.setAttribute('data-session-link', '31');
    document.body.appendChild(a);
    try {
      frames.shift()();
      expect(a).toHaveFocus();
    } finally {
      a.remove();
    }
  });

  it('gives up after its frames run out', () => {
    const frames = [];
    const win = { document, requestAnimationFrame: (fn) => frames.push(fn) };
    focusSessionLink(99, { win, frames: 2 });
    while (frames.length) frames.shift()();
    // Two retries after the first look, then nothing more is scheduled.
    expect(frames).toHaveLength(0);
  });
});

describe('httpsUrlOrNull', () => {
  it('keeps an https URL and nothing else', () => {
    expect(httpsUrlOrNull('https://example.test/a')).toBe(
      'https://example.test/a'
    );
    for (const v of [
      'http://example.test/a',
      'javascript:alert(1)',
      'nope',
      '',
      null,
      7,
    ]) {
      expect(httpsUrlOrNull(v), String(v)).toBeNull();
    }
  });
});

describe('formatClock', () => {
  it('formats seconds as m:ss or h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-1)).toBeNull();
  });
});
