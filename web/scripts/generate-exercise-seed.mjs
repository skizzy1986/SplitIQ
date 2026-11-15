// Generates supabase/seed/exercises.sql from the pinned upstream
// free-exercise-db file committed verbatim at
// supabase/seed/free-exercise-db/exercises.json (#435).
//
// Why a generator and two committed files rather than a hand-written seed: the
// 873 production `exercises` rows were loaded outside migrations, so the repo
// had no record of where they came from. Committing the upstream bytes lets a
// test prove provenance offline: the file's git blob sha equals upstream's at
// the pinned commit, and the rows mapped from it hash to the same md5
// fingerprint that production returns for its own rows. The SQL is then a pure
// function of that file, so `--check` can prove it has not been hand-edited.
//
// The seed is never applied to production (the rows are already there). On a
// fresh database it runs after the migrations; `on conflict (id) do nothing`
// makes a re-run a no-op.
//
//   node scripts/generate-exercise-seed.mjs          (writes the SQL)
//   node scripts/generate-exercise-seed.mjs --check  (exit 1 if it differs)
//
// Exit codes: 0 OK; 1 --check found the committed SQL stale or missing;
// 2 provenance refused (blob sha, row count or fingerprint mismatch) or an
// unreadable/invalid input. Node builtins only, like check-migrations.mjs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');

export const UPSTREAM_REPO = 'yuhonas/free-exercise-db';
export const UPSTREAM_SHA = '5197c055b356498944328bd00178b64a5e9f422c';
export const UPSTREAM_PATH = 'dist/exercises.json';
export const UPSTREAM_BLOB_SHA = '99d414913b62e96263f31d1babe5bb50d13444f5';
// Returned by the production read-back query (live snapshot, 2026-11-15):
//   select md5(string_agg(concat_ws('|', id, name, force, level, mechanic,
//     equipment, array_to_string(primary_muscles, ','),
//     array_to_string(secondary_muscles, ','), array_to_string(instructions, '§'),
//     category, array_to_string(images, ',')), E'\n' order by id collate "C"))
//   from public.exercises;
export const EXPECTED_FINGERPRINT = '149ed35cc65128b5ee354a997d7fdd79';
export const EXPECTED_ROWS = 873;

export const JSON_PATH = 'supabase/seed/free-exercise-db/exercises.json';
export const SQL_PATH = 'supabase/seed/exercises.sql';

// Insert order, and the order of the fingerprint's concat_ws arguments.
// created_at is left to its default and is not part of the fingerprint.
export const COLUMNS = [
  'id',
  'name',
  'force',
  'level',
  'mechanic',
  'equipment',
  'primary_muscles',
  'secondary_muscles',
  'instructions',
  'category',
  'images',
];
const ARRAY_COLUMNS = new Set([
  'primary_muscles',
  'secondary_muscles',
  'instructions',
  'images',
]);
// array_to_string separators used by the production fingerprint query.
const FINGERPRINT_SEPARATOR = { instructions: '§' };

// Git's object id for a blob: sha1 over "blob <byte length>\0<bytes>".
export function gitBlobSha(buf) {
  return createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

const textOrNull = (v, field, id) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    throw new Error(`${id}: ${field} is not a string`);
  }
  return v;
};

const arrayOrNull = (v, field, id) => {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
    throw new Error(`${id}: ${field} is not an array of strings`);
  }
  return v;
};

// Upstream camelCase record -> the snake_case exercises row. Absent fields are
// null; nothing is defaulted, so the row is exactly what the file says.
export function mapRecord(rec) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    throw new Error('record is not an object');
  }
  const id = rec.id;
  // ids are compared byte-wise (collate "C") by the fingerprint; ASCII keeps
  // JS code-unit order, UTF-8 byte order and C collation identical.
  if (typeof id !== 'string' || !/^[\x21-\x7e]+$/.test(id)) {
    throw new Error(`record id ${JSON.stringify(id)} is not printable ASCII`);
  }
  if (typeof rec.name !== 'string') {
    throw new Error(`${id}: name is required (exercises.name is not null)`);
  }
  return {
    id,
    name: rec.name,
    force: textOrNull(rec.force, 'force', id),
    level: textOrNull(rec.level, 'level', id),
    mechanic: textOrNull(rec.mechanic, 'mechanic', id),
    equipment: textOrNull(rec.equipment, 'equipment', id),
    primary_muscles: arrayOrNull(rec.primaryMuscles, 'primaryMuscles', id),
    secondary_muscles: arrayOrNull(
      rec.secondaryMuscles,
      'secondaryMuscles',
      id
    ),
    instructions: arrayOrNull(rec.instructions, 'instructions', id),
    category: textOrNull(rec.category, 'category', id),
    images: arrayOrNull(rec.images, 'images', id),
  };
}

const byIdBytes = (a, b) =>
  Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));

export function sortRows(rows) {
  return [...rows].sort(byIdBytes);
}

// Mirrors the production query: concat_ws skips NULL arguments (no separator
// for them) but keeps empty strings, so an empty array contributes ''. Rows are
// ordered byte-wise by id and joined with '\n' (no trailing newline); md5 is
// over the UTF-8 bytes.
export function fingerprint(rows) {
  const lines = sortRows(rows).map((row) =>
    COLUMNS.map((col) => {
      const v = row[col];
      if (v === null || v === undefined) return null;
      return ARRAY_COLUMNS.has(col)
        ? v.join(FINGERPRINT_SEPARATOR[col] ?? ',')
        : v;
    })
      .filter((v) => v !== null)
      .join('|')
  );
  return createHash('md5').update(lines.join('\n'), 'utf8').digest('hex');
}

// A plain '...' literal for ordinary text, so its meaning never depends on
// standard_conforming_strings: a value holding a backslash or a control
// character (one upstream instruction contains a newline) is written as an
// E'...' escape string instead, which is interpreted the same either way.
const isControl = (c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
const ESCAPES = {
  '\\': '\\\\',
  "'": "''",
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

export function sqlText(s) {
  if (s.includes('\0')) throw new Error('text cannot contain NUL');
  const chars = [...s];
  if (!chars.some((c) => c === '\\' || isControl(c))) {
    return `'${s.replaceAll("'", "''")}'`;
  }
  const body = chars
    .map(
      (c) =>
        ESCAPES[c] ??
        (isControl(c)
          ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
          : c)
    )
    .join('');
  return `E'${body}'`;
}

export function sqlValue(col, v) {
  if (v === null || v === undefined) return 'null';
  if (!ARRAY_COLUMNS.has(col)) return sqlText(v);
  if (v.length === 0) return "'{}'::text[]";
  return `array[${v.map(sqlText).join(', ')}]::text[]`;
}

export function toSeedSql(rows, fp = fingerprint(rows)) {
  const sorted = sortRows(rows);
  const header = [
    '-- supabase/seed/exercises.sql',
    '-- GENERATED by web/scripts/generate-exercise-seed.mjs; do not edit by hand.',
    '-- Regenerate in web/ with `node scripts/generate-exercise-seed.mjs`; verify',
    '-- with `node scripts/generate-exercise-seed.mjs --check`.',
    '--',
    `-- Source: ${UPSTREAM_REPO} at commit ${UPSTREAM_SHA},`,
    `-- ${UPSTREAM_PATH} (git blob ${UPSTREAM_BLOB_SHA}), committed verbatim`,
    `-- at ${JSON_PATH}. Licence: The Unlicense (see NOTICE.md).`,
    `-- Rows: ${sorted.length}. Fingerprint (md5; recipe in the generator): ${fp}`,
    '--',
    '-- NEVER applied to production: the production rows predate this file and',
    '-- return the same fingerprint. For a fresh database, run after the',
    '-- migrations (000 to 018); on conflict (id) do nothing makes a re-run a no-op.',
    '',
  ];
  const values = sorted.map(
    (row) => `  (${COLUMNS.map((col) => sqlValue(col, row[col])).join(', ')})`
  );
  return (
    header.join('\n') +
    `insert into public.exercises (${COLUMNS.join(', ')}) values\n` +
    values.join(',\n') +
    '\non conflict (id) do nothing;\n'
  );
}

// Parses and maps the upstream file, refusing (throwing) unless its blob sha,
// row count and fingerprint all equal the pinned values. `expected` exists so
// the refusal paths can be unit-tested.
export function buildSeed(
  buf,
  expected = {
    blobSha: UPSTREAM_BLOB_SHA,
    rows: EXPECTED_ROWS,
    fingerprint: EXPECTED_FINGERPRINT,
  }
) {
  const blobSha = gitBlobSha(buf);
  if (blobSha !== expected.blobSha) {
    throw new Error(
      `refused: blob sha ${blobSha} is not the pinned ${expected.blobSha}`
    );
  }
  const records = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(records)) throw new Error('refused: not a JSON array');
  const rows = records.map(mapRecord);
  if (new Set(rows.map((r) => r.id)).size !== rows.length) {
    throw new Error('refused: duplicate ids');
  }
  if (rows.length !== expected.rows) {
    throw new Error(`refused: ${rows.length} rows, expected ${expected.rows}`);
  }
  const fp = fingerprint(rows);
  if (fp !== expected.fingerprint) {
    throw new Error(
      `refused: fingerprint ${fp} is not the expected ${expected.fingerprint}`
    );
  }
  return { rows, blobSha, fingerprint: fp, sql: toSeedSql(rows, fp) };
}

export function run({
  jsonPath = join(repoRoot, JSON_PATH),
  sqlPath = join(repoRoot, SQL_PATH),
  check = false,
  expected,
  log = console.log,
  error = console.error,
} = {}) {
  let built;
  try {
    built = buildSeed(readFileSync(jsonPath), expected);
  } catch (e) {
    error(`generate-exercise-seed: ${e.message}`);
    return 2;
  }
  if (check) {
    const current = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : null;
    if (current !== built.sql) {
      error(
        `generate-exercise-seed: ${SQL_PATH} is ${current === null ? 'missing' : 'stale'}; regenerate with node scripts/generate-exercise-seed.mjs`
      );
      return 1;
    }
    log(
      `generate-exercise-seed: ${SQL_PATH} is current (${built.rows.length} rows, fingerprint ${built.fingerprint})`
    );
    return 0;
  }
  writeFileSync(sqlPath, built.sql);
  log(
    `generate-exercise-seed: wrote ${SQL_PATH} (${built.rows.length} rows, fingerprint ${built.fingerprint})`
  );
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--check')) {
    console.error('usage: node scripts/generate-exercise-seed.mjs [--check]');
    process.exit(2);
  }
  process.exit(run({ check: args.includes('--check') }));
}
