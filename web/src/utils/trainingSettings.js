// Pure helpers for the per-account training settings (#819, slice S3).
// Nothing here touches the network or logs a value: year of birth and the HR
// caution flag are personal (AC 42), so they never reach an error context.

export const HR_PATH_STRAP = 'strap';
export const HR_PATH_RPE = 'rpe';
export const HR_PATHS = [HR_PATH_STRAP, HR_PATH_RPE];

export const DEPTHS = ['simple', 'expert'];

export const MIN_AGE = 18;
const MIN_BIRTH_YEAR = 1900;

// The columns the database lets a signed-in user write (027's column grants).
// A key outside this list is dropped before the request, so a typo or a future
// column cannot slip through as a 42501 at runtime.
export const WRITABLE_COLUMNS = [
  'hr_path',
  'hr_path_chosen_on',
  'birth_year',
  'time_zone',
  'base_block_started_on',
  'screening_completed_on',
  'hr_caution',
  'depth',
];

// What an account with no row (or no table yet) reads as.
export const DEFAULT_SETTINGS = {
  hr_path: null,
  hr_path_chosen_on: null,
  birth_year: null,
  time_zone: null,
  base_block_started_on: null,
  screening_completed_on: null,
  hr_caution: false,
  depth: 'simple',
};

export function normalizeSettings(row) {
  const out = { ...DEFAULT_SETTINGS };
  if (!row || typeof row !== 'object') return out;
  if (HR_PATHS.includes(row.hr_path)) out.hr_path = row.hr_path;
  if (typeof row.hr_path_chosen_on === 'string') {
    out.hr_path_chosen_on = row.hr_path_chosen_on;
  }
  if (Number.isInteger(row.birth_year)) out.birth_year = row.birth_year;
  if (typeof row.time_zone === 'string') out.time_zone = row.time_zone;
  if (typeof row.base_block_started_on === 'string') {
    out.base_block_started_on = row.base_block_started_on;
  }
  if (typeof row.screening_completed_on === 'string') {
    out.screening_completed_on = row.screening_completed_on;
  }
  out.hr_caution = row.hr_caution === true;
  if (DEPTHS.includes(row.depth)) out.depth = row.depth;
  return out;
}

// Keep only writable columns, with undefined dropped (null is a real removal).
export function writablePatch(patch) {
  const out = {};
  for (const key of WRITABLE_COLUMNS) {
    if (patch && patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

// The local calendar date as YYYY-MM-DD, for hr_path_chosen_on.
export function localIsoDate(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "I have a strap or arm band" is the strap path. "I don't have one" is the
// no-strap (RPE) path, and so is a wrist watch on its own (AC 6).
export function pathForChoice(hasStrap) {
  return hasStrap ? HR_PATH_STRAP : HR_PATH_RPE;
}

// A four-digit year the user is old enough to have (the app is 18+). The
// result carries a code, never the year, so a caller cannot log it by accident.
export function parseBirthYear(raw, now = new Date()) {
  const text = String(raw ?? '').trim();
  if (!/^\d{4}$/.test(text)) return { ok: false, code: 'invalid' };
  const year = Number(text);
  const thisYear = now.getFullYear();
  if (year < MIN_BIRTH_YEAR || year > thisYear) {
    return { ok: false, code: 'invalid' };
  }
  if (thisYear - year < MIN_AGE) return { ok: false, code: 'too_young' };
  return { ok: true, year };
}
