// @vitest-environment node
//
// Guard for migration self-tests, from 027 on (#819; carried forward from
// 027's Gate 3). 027's first dev apply rolled back because a self-test called
// a function and counted its effect in the same SQL expression: every
// subquery in one statement reads the same snapshot, taken before the call
// ran, so the count cannot see the call's own write. The fix is to call in
// one statement and read in the next. This test fails any statement in a
// migration that both calls a function the same file creates and reads a
// table (a count or a subquery).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const FROM = 27;

// Comments out, function bodies out (they are the code under test, not the
// test), string literals emptied, whitespace folded.
function statements(text) {
  const noComments = text.replace(/--.*$/gm, '');
  const created = [
    ...noComments.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi
    ),
  ].map((m) => m[1].toLowerCase());
  const noBodies = noComments.replace(/\$fn\$[\s\S]*?\$fn\$/g, '$fn$$fn$');
  const noStrings = noBodies.replace(/'(?:[^']|'')*'/g, "''");
  const parts = noStrings
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return { created, parts };
}

export function callAndCount(text) {
  const { created, parts } = statements(text);
  const offenders = [];
  for (const stmt of parts) {
    const calls = created.filter((fn) =>
      new RegExp(`\\bpublic\\.${fn}\\s*\\(`).test(stmt)
    );
    if (calls.length === 0) continue;
    if (/\bcount\s*\(|\(\s*select\b|\bexists\s*\(/.test(stmt)) {
      offenders.push(stmt.slice(0, 160));
    }
  }
  return offenders;
}

const files = readdirSync(migrationsDir)
  .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
  .filter((f) => !f.endsWith('_rollback.sql'))
  .filter((f) => Number(f.slice(0, 3)) >= FROM);

describe('migration self-tests: no call-and-count in one statement', () => {
  it('covers 027 onwards, including 028', () => {
    expect(files).toContain('027_user_training_settings.sql');
    expect(files).toContain('028_anchor_provenance.sql');
  });

  it.each(files)('%s calls and reads in separate statements', (file) => {
    const text = readFileSync(resolve(migrationsDir, file), 'utf8');
    expect(callAndCount(text)).toEqual([]);
  });

  it('catches the pattern that broke 027 first time (known bad fixture)', () => {
    const bad = `
      create function public.rate_it(p int) returns jsonb language plpgsql as $fn$ begin return null; end; $fn$;
      do $$ begin
        if (public.rate_it(5))->>'status' <> 'saved'
           or (select count(*) from public.sessions where srpe = 5) <> 1 then
          raise exception 'bad; really';
        end if;
      end $$;`;
    expect(callAndCount(bad)).toHaveLength(1);
  });

  it('passes the same check split into two statements (known good fixture)', () => {
    const good = `
      create function public.rate_it(p int) returns jsonb language plpgsql as $fn$ begin return (select count(*) from x); end; $fn$;
      do $$ declare r jsonb; n int; begin
        r := public.rate_it(5);
        select count(*) into n from public.sessions where srpe = 5;
        if r->>'status' <> 'saved' or n <> 1 then raise exception 'public.rate_it(5) count(*)'; end if;
      end $$;`;
    expect(callAndCount(good)).toEqual([]);
  });
});
