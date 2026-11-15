// @vitest-environment node
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_FINGERPRINT,
  EXPECTED_ROWS,
  JSON_PATH,
  SQL_PATH,
  UPSTREAM_BLOB_SHA,
  UPSTREAM_SHA,
  buildSeed,
  fingerprint,
  gitBlobSha,
  mapRecord,
  run,
  sortRows,
  sqlText,
  toSeedSql,
} from '../generate-exercise-seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const jsonPath = join(repoRoot, JSON_PATH);
const sqlPath = join(repoRoot, SQL_PATH);
const jsonBuf = readFileSync(jsonPath);

// Three records chosen to hit every mapping branch: a null and an absent
// field, an empty array, a quote, an embedded newline, and ids whose byte
// order ('B' < '_' < 'a') differs from locale order.
const FIXTURE = [
  {
    id: 'a_row',
    name: "Farmer's Walk",
    force: null,
    level: 'beginner',
    mechanic: null,
    equipment: 'dumbbell',
    primaryMuscles: ['forearms'],
    secondaryMuscles: [],
    instructions: ['Pick up.', 'Walk.'],
    category: 'strongman',
    images: ['a_row/0.jpg'],
  },
  {
    id: 'B_row',
    name: 'B',
    force: 'push',
    level: 'expert',
    mechanic: 'compound',
    equipment: null,
    primaryMuscles: ['chest', 'triceps'],
    secondaryMuscles: ['shoulders'],
    instructions: ['Line one\nline two'],
    category: 'strength',
    images: [],
  },
  {
    id: '_row',
    name: 'Under',
    level: 'intermediate',
    primaryMuscles: [],
    secondaryMuscles: [],
    instructions: [],
    category: 'stretching',
    images: [],
  },
];
const fixtureBuf = Buffer.from(JSON.stringify(FIXTURE));

const withTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'exercise-seed-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const quiet = { log: () => {}, error: () => {} };

describe('AC9 the committed JSON is the upstream file at the pinned commit', () => {
  it('has the pinned git blob sha', () => {
    expect(UPSTREAM_SHA).toBe('5197c055b356498944328bd00178b64a5e9f422c');
    expect(gitBlobSha(jsonBuf)).toBe(UPSTREAM_BLOB_SHA);
    expect(UPSTREAM_BLOB_SHA).toBe('99d414913b62e96263f31d1babe5bb50d13444f5');
  });

  it('has no CR bytes, and .gitattributes keeps line-ending conversion off it', () => {
    expect(jsonBuf.includes(0x0d)).toBe(false);
    const attrs = readFileSync(join(repoRoot, '.gitattributes'), 'utf8');
    expect(attrs).toMatch(
      /^supabase\/seed\/free-exercise-db\/\*\.json -text$/m
    );
  });

  it('gitBlobSha matches git for a known blob (the empty blob)', () => {
    expect(gitBlobSha(Buffer.alloc(0))).toBe(
      'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
    );
  });
});

describe('AC10 the mapped rows match production', () => {
  it('has 873 rows with the production fingerprint', () => {
    const { rows, fingerprint: fp } = buildSeed(jsonBuf);
    expect(rows).toHaveLength(EXPECTED_ROWS);
    expect(EXPECTED_ROWS).toBe(873);
    expect(fp).toBe('149ed35cc65128b5ee354a997d7fdd79');
    expect(EXPECTED_FINGERPRINT).toBe(fp);
  });

  it('every id is printable ASCII and unique', () => {
    const { rows } = buildSeed(jsonBuf);
    expect(rows.every((r) => /^[\x21-\x7e]+$/.test(r.id))).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});

describe('AC12 the committed seed SQL is current and deterministic', () => {
  it('regenerating from the JSON byte-equals the committed SQL', () => {
    expect(buildSeed(jsonBuf).sql).toBe(readFileSync(sqlPath, 'utf8'));
  });

  it('is idempotent and carries the pinned SHA and fingerprint in its header', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql.trimEnd().endsWith('on conflict (id) do nothing;')).toBe(true);
    expect(sql).toContain(
      'insert into public.exercises (id, name, force, level, mechanic, equipment, primary_muscles, secondary_muscles, instructions, category, images) values'
    );
    const header = sql
      .split('\n')
      .filter((l) => l.startsWith('--'))
      .join('\n');
    expect(header).toContain(UPSTREAM_SHA);
    expect(header).toContain(UPSTREAM_BLOB_SHA);
    expect(header).toContain(EXPECTED_FINGERPRINT);
    expect(header).toMatch(/NEVER applied to production/);
  });

  it('has one row per line, so a review diff is per exercise', () => {
    const lines = readFileSync(sqlPath, 'utf8').split('\n');
    expect(lines.filter((l) => l.startsWith('  ('))).toHaveLength(873);
  });

  it('never depends on standard_conforming_strings: no backslash in a plain literal', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    // Strip E'...' literals (with '' and \x escapes), then look for any backslash.
    const plainOnly = sql.replace(/E'(?:[^'\\]|''|\\.)*'/g, '');
    expect(plainOnly.includes('\\')).toBe(false);
  });

  it('the CLI --check path agrees', () => {
    expect(run({ check: true, ...quiet })).toBe(0);
  });
});

describe('AC13 generator behaviour', () => {
  it('maps camelCase to snake_case and keeps nulls; absent fields are null', () => {
    expect(mapRecord(FIXTURE[0])).toEqual({
      id: 'a_row',
      name: "Farmer's Walk",
      force: null,
      level: 'beginner',
      mechanic: null,
      equipment: 'dumbbell',
      primary_muscles: ['forearms'],
      secondary_muscles: [],
      instructions: ['Pick up.', 'Walk.'],
      category: 'strongman',
      images: ['a_row/0.jpg'],
    });
    const absent = mapRecord(FIXTURE[2]);
    expect(absent.force).toBeNull();
    expect(absent.mechanic).toBeNull();
    expect(absent.equipment).toBeNull();
  });

  it('sorts by byte order of id, not locale order', () => {
    const rows = FIXTURE.map(mapRecord);
    expect(sortRows(rows).map((r) => r.id)).toEqual(['B_row', '_row', 'a_row']);
  });

  it('fingerprint skips nulls, keeps empty strings, joins instructions with §', () => {
    const expected = [
      'B_row|B|push|expert|compound|chest,triceps|shoulders|Line one\nline two|strength|',
      '_row|Under|intermediate||||stretching|',
      "a_row|Farmer's Walk|beginner|dumbbell|forearms||Pick up.§Walk.|strongman|a_row/0.jpg",
    ].join('\n');
    expect(fingerprint(FIXTURE.map(mapRecord))).toBe(
      createHash('md5').update(expected, 'utf8').digest('hex')
    );
  });

  it('emits nulls as null, doubles quotes, empty arrays as {}, newlines as E-strings', () => {
    const sql = toSeedSql(FIXTURE.map(mapRecord));
    const rows = sql.split('\n').filter((l) => l.startsWith('  ('));
    expect(rows).toEqual([
      "  ('B_row', 'B', 'push', 'expert', 'compound', null, array['chest', 'triceps']::text[], array['shoulders']::text[], array[E'Line one\\nline two']::text[], 'strength', '{}'::text[]),",
      "  ('_row', 'Under', null, 'intermediate', null, null, '{}'::text[], '{}'::text[], '{}'::text[], 'stretching', '{}'::text[]),",
      "  ('a_row', 'Farmer''s Walk', null, 'beginner', null, 'dumbbell', array['forearms']::text[], '{}'::text[], array['Pick up.', 'Walk.']::text[], 'strongman', array['a_row/0.jpg']::text[])",
    ]);
  });

  it.each([
    ['plain', 'abc', "'abc'"],
    ['quote', "it's", "'it''s'"],
    ['backslash', 'a\\b', "E'a\\\\b'"],
    ['tab and quote', "a\t'b", "E'a\\t''b'"],
    ['other control char', 'a\x01b', "E'a\\x01b'"],
  ])('sqlText escapes %s', (_label, input, output) => {
    expect(sqlText(input)).toBe(output);
  });

  it('rejects a non-ASCII id, a missing name and a non-array muscle list', () => {
    expect(() => mapRecord({ ...FIXTURE[0], id: 'Ä_row' })).toThrow(/ASCII/);
    expect(() => mapRecord({ ...FIXTURE[0], name: undefined })).toThrow(
      /name is required/
    );
    expect(() =>
      mapRecord({ ...FIXTURE[0], primaryMuscles: 'forearms' })
    ).toThrow(/array of strings/);
  });

  it('refuses a blob sha mismatch (the fixture is not the pinned file)', () => {
    expect(() => buildSeed(fixtureBuf)).toThrow(/refused: blob sha/);
  });

  it('refuses a fingerprint mismatch even when the sha is accepted', () => {
    expect(() =>
      buildSeed(fixtureBuf, {
        blobSha: gitBlobSha(fixtureBuf),
        rows: 3,
        fingerprint: '0'.repeat(32),
      })
    ).toThrow(/refused: fingerprint/);
  });

  it('refuses a row-count mismatch', () => {
    expect(() =>
      buildSeed(fixtureBuf, {
        blobSha: gitBlobSha(fixtureBuf),
        rows: 4,
        fingerprint: fingerprint(FIXTURE.map(mapRecord)),
      })
    ).toThrow(/refused: 3 rows, expected 4/);
  });

  it('accepts the fixture when every expected value matches', () => {
    const fp = fingerprint(FIXTURE.map(mapRecord));
    const built = buildSeed(fixtureBuf, {
      blobSha: gitBlobSha(fixtureBuf),
      rows: 3,
      fingerprint: fp,
    });
    expect(built.fingerprint).toBe(fp);
    expect(built.sql).toContain(fp);
  });

  it('run() refuses to write when the JSON is mutated by one byte', () => {
    withTmp((dir) => {
      const mutated = Buffer.from(jsonBuf);
      const at = mutated.indexOf('"3/4 Sit-Up"') + 1;
      mutated[at] = '4'.charCodeAt(0);
      const mutatedPath = join(dir, 'exercises.json');
      const outPath = join(dir, 'exercises.sql');
      writeFileSync(mutatedPath, mutated);
      expect(run({ jsonPath: mutatedPath, sqlPath: outPath, ...quiet })).toBe(
        2
      );
      expect(existsSync(outPath)).toBe(false);
    });
  });

  it('run() writes the SQL, and --check fails on a stale or missing file', () => {
    withTmp((dir) => {
      const outPath = join(dir, 'exercises.sql');
      expect(run({ sqlPath: outPath, check: true, ...quiet })).toBe(1);
      expect(run({ sqlPath: outPath, ...quiet })).toBe(0);
      expect(readFileSync(outPath, 'utf8')).toBe(readFileSync(sqlPath, 'utf8'));
      expect(run({ sqlPath: outPath, check: true, ...quiet })).toBe(0);
      writeFileSync(outPath, readFileSync(outPath, 'utf8') + '-- edited\n');
      expect(run({ sqlPath: outPath, check: true, ...quiet })).toBe(1);
    });
  });
});

describe('AC15 NOTICE.md credits free-exercise-db at the pinned commit', () => {
  it('has the section with the SHA, blob sha and licence', () => {
    const notice = readFileSync(join(repoRoot, 'NOTICE.md'), 'utf8');
    expect(notice).toMatch(/^## free-exercise-db\b.*Unlicense/m);
    expect(notice).toContain(UPSTREAM_SHA);
    expect(notice).toContain(UPSTREAM_BLOB_SHA);
    expect(notice).toContain(JSON_PATH);
    expect(notice).toContain(SQL_PATH);
    expect(notice).toMatch(/Not established/);
  });
});
