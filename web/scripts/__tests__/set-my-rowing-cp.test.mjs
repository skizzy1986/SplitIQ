// @vitest-environment node
//
// Static contract for #797: set_my_rowing_cp() saves a tester's rowing CP in
// one step. CI has no database, so this reads the SQL from disk. The file is
// not applied here; its own self-test (sentinel SF025) runs on apply, and the
// same file was rehearsed on a local PostgreSQL 17 built from the dev baseline,
// with two real connections for the concurrent-save case (criterion 7).
// One block per Gate 1 criterion.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const sql = strip(read('025_set_my_rowing_cp.sql'));
const rollback = strip(read('025_set_my_rowing_cp_rollback.sql'));
const manifest = JSON.parse(read('manifest.json'));

// The function body, apart from the self-test.
const fnStart = sql.indexOf('create function public.set_my_rowing_cp(');
const fnEnd = sql.indexOf('$fn$;', fnStart);
const fn = sql.slice(fnStart, fnEnd);
// Everything after the function: grants, comment and the self-test.
const selfTest = sql.slice(fnEnd);
// The form's bounds (MIN_CP / MAX_CP in web/src/utils/firstRunGuide.js, #811).
// #811 pins those to the same numbers, so the form and the database agree.
const MIN_CP = 50;
const MAX_CP = 500;

describe('025 set_my_rowing_cp', () => {
  it('is one transaction that reloads the PostgREST schema cache', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(fnStart).toBeGreaterThan(0);
  });

  it('1. saving retires the live row and inserts one new live row: value, W, unvalidated, tester', () => {
    expect(fn).toMatch(
      /update public\.anchors set superseded_at = v_now where user_id = v_uid and key = 'rowing_cp' and superseded_at is null;/
    );
    expect(fn).toContain(
      "insert into public.anchors (user_id, key, value, unit, status, source, created_at) values (v_uid, 'rowing_cp', p_watts::text, 'w', 'unvalidated', 'tester', v_now);"
    );
    // Retire before insert, or the one-live-per-key index refuses the insert.
    expect(fn.indexOf('update public.anchors')).toBeLessThan(
      fn.indexOf('insert into public.anchors')
    );
    expect(selfTest).toContain('c1: one live row');
  });

  // Gate 3 round 3 (#817 CR suggestion 1, Scott 26 Nov): one clock reading,
  // taken after the lock, stamps both the retirement and the new row, so each
  // hand-off is an exact tie and created_at order matches live order in a race.
  it('1. the new row is stamped with the same time that retires the old one', () => {
    expect(fn).toContain('v_now timestamptz;');
    expect(fn).toContain('v_now := pg_catalog.clock_timestamp();');
    expect(
      fn.indexOf('v_now := pg_catalog.clock_timestamp();')
    ).toBeGreaterThan(fn.indexOf('pg_advisory_xact_lock'));
    expect(fn.indexOf('v_now := pg_catalog.clock_timestamp();')).toBeLessThan(
      fn.indexOf('update public.anchors')
    );
    expect(fn.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(fn).not.toMatch(/\bnow\(\)/);
    expect(selfTest).toContain('c1: hand-off stamp');
  });

  it('2. history is kept: the old row is retired, never deleted', () => {
    expect(fn).not.toMatch(/delete from/);
    expect(selfTest).toContain('c2: history');
  });

  it('3. the first save works when there is no live row yet', () => {
    expect(selfTest).toContain('c3: first save');
    expect(fn).toContain("'replaced', v_retired > 0");
  });

  it('4. all or nothing: a failed insert leaves the old CP live', () => {
    // One function call is one statement, so its update and insert commit or
    // roll back together. The self-test forces the insert to fail.
    expect(fn).not.toMatch(/exception when/);
    // The throwaway check must let the retiring update through and refuse only
    // the insert, or the test would stop before the half-finished state.
    expect(selfTest).toContain(
      "check (superseded_at is not null or value <> '220') not valid"
    );
    expect(selfTest).toContain('c4: all or nothing');
  });

  it(`5. the database refuses values outside ${MIN_CP}–${MAX_CP} W, the same range as the form`, () => {
    expect(fn).toContain(
      `if p_watts is null or p_watts < ${MIN_CP} or p_watts > ${MAX_CP} then`
    );
    expect(fn).toContain("errcode = '22023'");
    expect(selfTest).toContain('c5: refused');
  });

  it('6. owner only: runs as the caller under RLS, signed-in users only', () => {
    expect(fn).toContain('security invoker');
    expect(fn).not.toContain('security definer');
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain('v_uid uuid := auth.uid();');
    expect(fn).toContain("errcode = '28000'");
    expect(sql).toContain(
      'revoke all on function public.set_my_rowing_cp(integer) from public, anon, authenticated, service_role;'
    );
    expect(sql).toContain(
      'grant execute on function public.set_my_rowing_cp(integer) to authenticated;'
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.set_my_rowing_cp\(integer\) to (anon|service_role|public)/
    );
    expect(selfTest).toContain('set local role authenticated');
    expect(selfTest).toContain('set local role anon');
    expect(selfTest).toContain('c6: other user untouched');
  });

  it('7. concurrent saves queue on a per-user lock instead of hitting the unique index', () => {
    expect(fn).toContain(
      "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rowing_cp:' || v_uid::text, 0));"
    );
    expect(fn.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      fn.indexOf('update public.anchors')
    );
  });

  it('8. saving over the 200 W sample placeholder retires it, and clearing samples keeps the saved CP', () => {
    expect(selfTest).toContain(
      "to_regprocedure('public.sample_data_load(uuid,date,boolean)')"
    );
    expect(selfTest).toContain('c8: placeholder retired');
    expect(selfTest).toContain('c8: own cp kept after clear');
  });

  it('10. testers only: unapplied in production, rollback drops only the function', () => {
    const entry = manifest.files.find(
      (f) => f.file === '025_set_my_rowing_cp.sql'
    );
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(797);
    expect(entry?.reason).toMatch(
      /dev only, tester client, not for production/i
    );
    expect(entry?.reason).toMatch(/superseded on dev by 028's `save_my_cp`/i);
    expect(rollback).toContain(
      'drop function if exists public.set_my_rowing_cp(integer);'
    );
    expect(rollback).not.toMatch(/delete from|update public|truncate/);
    expect(rollback).toContain("notify pgrst, 'reload schema';");
  });

  it('self-test rolls itself back with the SF025 sentinel', () => {
    expect(sql).toContain(
      "raise exception using errcode = 'sf025', message = 'rollback synthetic rows';"
    );
    expect(sql).toContain("exception when sqlstate 'sf025' then null;");
    expect(sql).toContain(
      'comment on function public.set_my_rowing_cp(integer)'
    );
  });
});
