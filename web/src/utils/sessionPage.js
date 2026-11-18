import { toISODate } from './dateFormat.js';
import { parseDurationMinutes } from './duration.js';
import { wattsToPace500 } from './pace.js';
import { isCompletedStatus } from './sessionStatus.js';

// A session id as it appears in a URL: a positive integer, no leading zero.
// Sixteen digits can still exceed Number's safe range, so parseSessionId
// checks that too.
export const SESSION_ID_RE = /^[1-9]\d{0,15}$/;

export function parseSessionId(value) {
  const s = String(value ?? '');
  if (!SESSION_ID_RE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function sessionHref(id) {
  return `#/session/${id}`;
}

// The id in `#/session/<id>`, or null for anything else (a bad id, an extra
// segment, another route).
export function sessionIdFromHash(hash = '') {
  const path = String(hash)
    .replace(/^#?\/?/, '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const m = /^session\/([^/]+)$/.exec(path);
  return m ? parseSessionId(m[1]) : null;
}

// The raw sessions.type values that open a session page, flagged the way
// utils/sessionLog.js flags them.
export function sessionSport(rawType) {
  const t = (rawType ?? '').toLowerCase();
  if (t === 'erg') return 'erg';
  if (t === 'cycling' || t === 'bike' || t === 'ride') return 'cycling';
  return null;
}

// Accepts either a selectSessionLog entry (flags and `_id`) or a raw row.
export function canOpenSessionPage(entry) {
  if (!entry || !isCompletedStatus(entry.status)) return false;
  const sport = entry._isErg
    ? 'erg'
    : entry._isCycling
      ? 'cycling'
      : sessionSport(entry.type);
  if (!sport) return false;
  return parseSessionId(entry._id ?? entry.id) != null;
}

const DAY_MS = 86_400_000;

// Mean of one stored field over completed same-sport sessions in the `days`
// before `dateIso` (the session's own day excluded, so the session never
// grounds itself). Null with fewer than three: too few to say anything about.
function recentMean(sessions, sport, dateIso, field, days) {
  if (!dateIso || !Array.isArray(sessions)) return null;
  const end = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(end)) return null;
  const startIso = new Date(end - days * DAY_MS).toISOString().slice(0, 10);
  const values = [];
  for (const s of sessions) {
    if (!isCompletedStatus(s?.status) || sessionSport(s.type) !== sport)
      continue;
    if (!(s[field] > 0)) continue;
    const iso = s.date_iso ?? toISODate(s.date);
    if (!iso || iso < startIso || iso >= dateIso) continue;
    values.push(s[field]);
  }
  if (values.length < 3) return null;
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    count: values.length,
  };
}

// Average power's own-history grounding: { meanWatts, count } or null.
export function recentPowerBaseline(sessions, sport, dateIso, days = 30) {
  const r = recentMean(sessions, sport, dateIso, 'avg_watts', days);
  return r && { meanWatts: r.mean, count: r.count };
}

// Average heart rate's, by the same rule: { meanHr, count } or null.
export function recentHrBaseline(sessions, sport, dateIso, days = 30) {
  const r = recentMean(sessions, sport, dateIso, 'avg_hr', days);
  return r && { meanHr: r.mean, count: r.count };
}

const positive = (v) => (typeof v === 'number' && v > 0 ? v : null);

// The stored row's summary in numbers, each null when absent. Pace and speed
// derive from the row as the series rules do: rowing pace from distance and
// time, falling back to average power; cycling speed from distance and time.
export function storedSummary(session, sport) {
  const minutes = positive(parseDurationMinutes(session?.duration));
  const distanceM = positive(session?.distance_m);
  const avgWatts = positive(session?.avg_watts);
  const seconds = minutes ? minutes * 60 : null;
  let pace500 = null;
  let speedKmh = null;
  if (sport === 'erg') {
    if (distanceM && seconds) pace500 = (500 * seconds) / distanceM;
    else if (avgWatts) pace500 = wattsToPace500(avgWatts);
  } else if (sport === 'cycling' && distanceM && seconds) {
    speedKmh = (distanceM / seconds) * 3.6;
  }
  return {
    minutes,
    distanceM,
    avgWatts,
    avgHr: positive(session?.avg_hr),
    srpe: positive(session?.srpe),
    pace500,
    speedKmh,
  };
}

// After leaving a session page, put focus back on the link that opened it.
// The list it lives in may still be mounting, so look for a few frames. The
// one DOM helper in this file, shared by both shells; `win` is injectable so
// it can be tested without a browser.
export function focusSessionLink(id, { frames = 10, win = window } = {}) {
  const el = win.document.querySelector(`[data-session-link="${id}"]`);
  if (el) el.focus();
  else if (frames > 0) {
    win.requestAnimationFrame(() =>
      focusSessionLink(id, { frames: frames - 1, win })
    );
  }
}

// A link a source supplied, kept only when it is a string that parses as an
// https: URL. Anything else (http:, javascript:, a non-string) is null, so a
// malformed or hostile value never reaches an href.
export function httpsUrlOrNull(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    // Not a URL at all: an expected non-event, treated as no link.
    return null;
  }
}

// Seconds as h:mm:ss or m:ss, for durations and the trace's time axis.
export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
