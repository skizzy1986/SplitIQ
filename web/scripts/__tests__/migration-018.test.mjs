// @vitest-environment node
// Static checks over 018_exercises_and_strength_views.sql and the mirror
// files it reconciles (#435). CI has no database, so these pin the text; the
// production no-op is proven by the read-back in the PR.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const read = (f) => readFileSync(join(migrationsDir, f), 'utf8');

// Comments are stripped before any assertion, so header prose can never
// satisfy (or trip) a check meant for executable SQL. None of these files puts
// `--` or `/*` inside a string literal.
const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

const RAW = read('018_exercises_and_strength_views.sql');
const SQL = stripComments(RAW);
const ROLLBACK_RAW = read('018_exercises_and_strength_views_rollback.sql');

// Live security_invoker spelling per view (production reloptions, 2026-11-15).
const CREATED_VIEWS = [
  ['exercise_with_media', 'true'],
  ['exercise_prs', 'on'],
  ['exercise_last_performance', 'true'],
  ['exercise_progression', 'true'],
  ['strength_volume_daily', 'on'],
  ['exercise_media_gaps', 'true'],
];
const ALL_VIEWS = ['strength_set_metrics', ...CREATED_VIEWS.map(([v]) => v)];

const EXERCISES_COLUMNS = [
  ['id', 'text'],
  ['name', 'text'],
  ['force', 'text'],
  ['level', 'text'],
  ['mechanic', 'text'],
  ['equipment', 'text'],
  ['primary_muscles', 'text[]'],
  ['secondary_muscles', 'text[]'],
  ['instructions', 'text[]'],
  ['category', 'text'],
  ['images', 'text[]'],
  ['created_at', 'timestamptz'],
];

// Parses `create table if not exists <name> ( ... );` into [column, type]
// pairs, skipping table constraints.
function tableColumns(sql, tableRe) {
  const m = sql.match(
    new RegExp(
      `create table if not exists ${tableRe} \\(([\\s\\S]*?)\\n\\);`,
      'i'
    )
  );
  if (!m) throw new Error(`no create table for ${tableRe}`);
  return m[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => l && !/^constraint\b/i.test(l))
    .map((l) => {
      const [, col, type] = l.match(/^(\w+)\s+([\w[\]]+)/);
      return [col, type.toLowerCase()];
    });
}

// The closing shape guard: the last DO block in the file.
const GUARD = SQL.slice(SQL.lastIndexOf('do $$'));

// Column names from the guard's expected arrays: the exercises array, then one
// ('view', array[...]) row per view.
const namesOf = (arrayBody) =>
  [...arrayBody.matchAll(/'(\w+) [^']+'/g)].map((m) => m[1]);
function guardColumns() {
  const out = {};
  // Anchored on `] then` / `])` because the items themselves contain `[]`.
  const ex = GUARD.match(/v_cols is distinct from array\[([\s\S]*?)\] then/);
  out.exercises = namesOf(ex[1]);
  for (const m of GUARD.matchAll(/\('(\w+)', array\[([\s\S]*?)\]\)/g)) {
    out[m[1]] = namesOf(m[2]);
  }
  return out;
}

describe('018 exercises capture (AC2)', () => {
  it('creates exercises with the 11 live data columns plus created_at, text id', () => {
    expect(tableColumns(SQL, 'public\\.exercises')).toEqual(EXERCISES_COLUMNS);
    expect(SQL).toMatch(/id\s+text not null,/);
    expect(SQL).toMatch(/constraint exercises_pkey primary key \(id\)/);
    const block = SQL.match(
      /create table if not exists public\.exercises \(([\s\S]*?)\n\);/
    )[1];
    expect(block).not.toMatch(/uuid|gen_random_uuid/);
  });

  it('creates the three live indexes with their live definitions', () => {
    expect(SQL).toMatch(
      /create index if not exists exercises_name_idx\s+on public\.exercises using gin \(to_tsvector\('english'::regconfig, name\)\);/
    );
    expect(SQL).toMatch(
      /create index if not exists exercises_category_idx\s+on public\.exercises using btree \(category\);/
    );
    expect(SQL).toMatch(
      /create index if not exists exercises_equipment_idx\s+on public\.exercises using btree \(equipment\);/
    );
  });

  it('enables RLS only when it is off, and creates exercises_read only when absent', () => {
    expect(SQL).toMatch(
      /if not \(select relrowsecurity from pg_class\s+where oid = 'public\.exercises'::regclass\) then\s+alter table public\.exercises enable row level security;/
    );
    expect(SQL).toMatch(
      /if not exists \(select 1 from pg_policies\s+where schemaname = 'public' and tablename = 'exercises'\s+and policyname = 'exercises_read'\) then\s+create policy exercises_read on public\.exercises\s+for select to authenticated\s+using \(true\);/
    );
  });
});

describe('018 views (AC3)', () => {
  it.each(CREATED_VIEWS)(
    '%s is created only inside a to_regclass guard, with security_invoker = %s',
    (view, spelling) => {
      const re = new RegExp(
        `if to_regclass\\('public\\.${view}'\\) is null then\\s+execute \\$view\\$\\s*create view public\\.${view} with \\(security_invoker = ${spelling}\\) as\\s`
      );
      expect(SQL).toMatch(re);
    }
  );

  it('creates exactly the six views, never replaces one, and drops nothing', () => {
    expect(
      [...SQL.matchAll(/create view public\.(\w+)/g)].map((m) => m[1])
    ).toEqual(CREATED_VIEWS.map(([v]) => v));
    expect(SQL).not.toMatch(/create\s+or\s+replace/i);
    expect(SQL).not.toMatch(/\bdrop\b/i);
  });

  it('schema-qualifies every relation a view body reads', () => {
    const bodies = [...SQL.matchAll(/\$view\$([\s\S]*?)\$view\$/g)].map(
      (m) => m[1]
    );
    expect(bodies).toHaveLength(6);
    for (const body of bodies) {
      for (const m of body.matchAll(/\b(?:FROM|JOIN)\s+\(*(\w+(?:\.\w+)?)/g)) {
        if (m[1] === 'last_wk') continue; // the CTE in exercise_last_performance
        expect(m[1]).toMatch(/^public\./);
      }
    }
  });
});

describe('018 strength_set_metrics (AC4)', () => {
  it('sets security_invoker = on only when it is not already set, and never recreates it', () => {
    expect(SQL).toMatch(
      /if not exists \(select 1\s+from pg_class c, unnest\(coalesce\(c\.reloptions, '\{\}'::text\[\]\)\) as o\(opt\)\s+where c\.oid = 'public\.strength_set_metrics'::regclass\s+and o\.opt ~\* '\^security_invoker=\(true\|on\|yes\|1\)\$'\) then\s+alter view public\.strength_set_metrics set \(security_invoker = on\);/
    );
    expect(SQL).not.toMatch(/create view public\.strength_set_metrics/);
  });
});

describe('018 order (AC5)', () => {
  it('exercises, then the strength_set_metrics fix, then the views, then the guard', () => {
    const at = (s) => {
      const i = SQL.indexOf(s);
      if (i < 0) throw new Error(`018 lacks: ${s}`);
      return i;
    };
    const order = [
      at('create table if not exists public.exercises'),
      at('create policy exercises_read'),
      at('alter view public.strength_set_metrics set'),
      ...CREATED_VIEWS.map(([v]) => at(`create view public.${v} `)),
      SQL.lastIndexOf('do $$'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(SQL.lastIndexOf('create view')).toBe(
      at('create view public.exercise_media_gaps ')
    );
  });
});

describe('018 shape guard (AC6)', () => {
  it('raises an 018: error and covers all 8 objects', () => {
    expect(GUARD).toMatch(/raise exception '018: /);
    expect(GUARD).toContain("to_regclass('public.exercises')");
    for (const view of ALL_VIEWS) expect(GUARD).toContain(`('${view}', array[`);
  });

  it('checks every property the spec names', () => {
    for (const needle of [
      'indisprimary',
      'relrowsecurity',
      "policyname = 'exercises_read'",
      "cmd = 'SELECT'",
      "roles = '{authenticated}'::name[]",
      'exercises_name_idx',
      'exercises_category_idx',
      'exercises_equipment_idx',
      "is distinct from 'v'",
      "security_invoker=(true|on|yes|1)$'",
      'format_type(a.atttypid, a.atttypmod)',
    ]) {
      expect(GUARD).toContain(needle);
    }
  });

  it("the guard's exercises column list equals the create-table column list", () => {
    expect(guardColumns().exercises).toEqual(EXERCISES_COLUMNS.map(([c]) => c));
  });
});

describe('018 writes no data and changes no grants (AC7)', () => {
  it.each([
    ['insert', /\binsert\b/i],
    ['update', /\bupdate\b/i],
    ['delete', /\bdelete\b/i],
    ['truncate', /\btruncate\b/i],
    ['grant', /\bgrant\b/i],
    ['revoke', /\brevoke\b/i],
  ])('contains no %s', (_label, re) => {
    expect(SQL).not.toMatch(re);
  });
});

describe('018 rollback (AC8)', () => {
  it('is select 1; with the capture headers', () => {
    expect(stripComments(ROLLBACK_RAW).trim()).toBe('select 1;');
    expect(ROLLBACK_RAW).toMatch(/NOT auto-applied/);
    expect(ROLLBACK_RAW).toMatch(/DELIBERATELY A NO-OP/);
  });
});

describe('018 client contract (AC11)', () => {
  // Every column the app reads from these relations (web/src/StrengthLogger.jsx,
  // web/src/hooks/useStrengthPRs.js).
  const CONTRACT = {
    exercises: ['id', 'name', 'equipment', 'primary_muscles', 'category'],
    exercise_with_media: [
      'primary_muscles',
      'secondary_muscles',
      'video_front_url',
      'video_side_url',
      'poster_front_url',
      'media_tier',
      'images',
    ],
    exercise_last_performance: [
      'exercise_id',
      'workout_date',
      'set_index',
      'weight_kg',
      'reps',
      'rpe',
      'e1rm_kg',
    ],
    exercise_prs: [
      'exercise_name',
      'exercise_id',
      'best_e1rm_kg',
      'heaviest_kg',
      'logged_sets',
    ],
  };

  it.each(Object.entries(CONTRACT))(
    "the guard's %s columns include every column the client reads",
    (relation, cols) => {
      expect(guardColumns()[relation]).toEqual(expect.arrayContaining(cols));
    }
  );

  it('the guard lists columns for all 7 views', () => {
    expect(Object.keys(guardColumns()).sort()).toEqual(
      ['exercises', ...ALL_VIEWS].sort()
    );
  });
});

describe('Option A mirrors agree with 018 (AC14)', () => {
  const m000 = read('000_initial_schema.sql');

  it('000 exercises block has the same columns and types as 018', () => {
    expect(tableColumns(stripComments(m000), 'exercises')).toEqual(
      tableColumns(SQL, 'public\\.exercises')
    );
    for (const idx of [
      'exercises_name_idx',
      'exercises_category_idx',
      'exercises_equipment_idx',
    ]) {
      expect(stripComments(m000)).toContain(
        `CREATE INDEX IF NOT EXISTS ${idx}`
      );
    }
  });

  it('001 names the exercises policy exercises_read, as live', () => {
    const m001 = stripComments(read('001_enable_rls.sql'));
    expect(m001).toMatch(
      /CREATE POLICY exercises_read ON exercises\s+FOR SELECT\s+TO authenticated\s+USING \(true\);/
    );
    expect(m001).not.toMatch(/CREATE POLICY exercises_select_authenticated/);
  });

  it('001 drops the pre-#435 policy name, so 018 finds exactly one policy', () => {
    expect(stripComments(read('001_enable_rls.sql'))).toContain(
      'DROP POLICY IF EXISTS exercises_select_authenticated ON exercises;'
    );
  });

  it('007 declares strength_set_metrics with security_invoker = on', () => {
    expect(stripComments(read('007_strength_subsystem.sql'))).toContain(
      'create or replace view public.strength_set_metrics with (security_invoker = on) as'
    );
  });

  it('000 header names the replay breaks that remain, and they are still where it says', () => {
    expect(m000).toContain('007_strength_subsystem.sql:64');
    expect(m000).toContain('008_sessions_date_iso.sql:53');
    expect(m000).toMatch(/STILL\s+(?:--\s+)?FAILS/);
    expect(m000).toMatch(/not run/);
    // The cited lines and the cause they describe.
    const line = (f, n) => read(f).split('\n')[n - 1];
    expect(line('007_strength_subsystem.sql', 64)).toMatch(
      /session_id\s+bigint references public\.sessions\(id\)/
    );
    expect(line('008_sessions_date_iso.sql', 53)).toContain(
      'public.session_date_to_iso(date)'
    );
    expect(stripComments(m000)).toMatch(/id\s+uuid primary key/);
    expect(stripComments(m000)).toMatch(/date\s+date not null/);
  });
});
