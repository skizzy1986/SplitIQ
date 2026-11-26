// @vitest-environment node
//
// Static contract for #819 slice S1: 026 replaces sample_data_load so a load
// no longer inserts a 200 W rowing_cp placeholder (hidden-CP AC 45). CI has
// no database, so this reads the SQL from disk. The file is not applied here;
// its own self-test (sentinel SF026) runs on apply. The DEV_DATABASE.md apply
// record is left as a TODO until Scott says yes and the migration is applied.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const raw = read('026_sample_data_no_cp_anchor.sql');
const sql = strip(raw);
const rawRollback = read('026_sample_data_no_cp_anchor_rollback.sql');
const rollback = strip(rawRollback);
const raw024 = read('024_sample_data.sql');
const sql024 = strip(raw024);
const manifest = JSON.parse(read('manifest.json'));

const loaderStart = sql.indexOf(
  'create or replace function public.sample_data_load('
);
const loaderEnd = sql.indexOf('$fn$;', loaderStart);
const loader = sql.slice(loaderStart, loaderEnd);
const selfTest = sql.slice(loaderEnd);

const rollbackLoaderStart = rollback.indexOf(
  'create or replace function public.sample_data_load('
);
const rollbackLoaderEnd = rollback.indexOf('$fn$;', rollbackLoaderStart);
const rollbackLoader = rollback.slice(rollbackLoaderStart, rollbackLoaderEnd);

describe('026 sample data no cp anchor', () => {
  it('is one transaction that reloads the PostgREST schema cache and needs 024', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(sql).toContain('apply 024_sample_data first');
    expect(loaderStart).toBeGreaterThan(0);
  });

  it('is recorded in the manifest as unapplied, dev only, never production, for #819', () => {
    const entry = manifest.files.find(
      (f) => f.file === '026_sample_data_no_cp_anchor.sql'
    );
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(819);
    expect(entry?.reason).toMatch(
      /dev only until scott says otherwise; this manifest tracks production/i
    );
    expect(entry?.reason).toMatch(/never production/i);
    expect(entry?.reason).toMatch(/026 never goes to production/i);
    expect(entry?.reason).toMatch(/not applied to either project yet/i);
    expect(entry?.reason).not.toMatch(/applied to splitiq dev/i);
  });

  it('header says NOT auto-applied, never production, and does not delete existing sample CPs', () => {
    expect(raw).toMatch(/NOT auto-applied/);
    expect(raw).toMatch(/never production/i);
    expect(raw).toMatch(/does not delete[\s-]*existing sample CP anchors/i);
  });

  it('H45: the loader inserts no anchors row; clear still removes ledgered anchors', () => {
    expect(loader).not.toContain('insert into public.anchors');
    expect(loader).not.toContain('v_aid');
    expect(loader).not.toContain('placeholder critical power. replace');
    expect(loader).toContain("'anchors', n_anchor");
    expect(loader).toContain('n_anchor integer := 0');
    expect(loader).not.toMatch(/n_anchor\s*:=\s*1/);
    // 200 W remains only as the scale for sample session watts.
    expect(loader).toContain('c_cp constant numeric := 200');
    expect(loader).toContain('round(c_cp *');
    expect(loader).not.toContain('delete from public.anchors');

    // 026 does not replace or drop the 024 clear, which still deletes
    // ledgered anchors; the self-test checks that behaviour on apply.
    expect(sql).not.toContain(
      'create or replace function public.sample_data_clear'
    );
    expect(sql).not.toContain('create function public.sample_data_clear');
    expect(sql024).toContain("l.table_name = 'anchors'");
    expect(sql024).toContain('delete from public.anchors a');
    expect(selfTest).toContain("(ra->>'anchors')::int <> 0");
    expect(selfTest).toContain('load inserted an anchors row');
    expect(selfTest).toContain('load wrote an anchors ledger row');
    expect(selfTest).toContain('clear did not remove the ledgered anchor');
    expect(selfTest).toContain('clear left a ledgered anchor behind');
    expect(selfTest).toContain("clear touched another user''s anchor");
  });

  // 026 is a create-or-replace of 024's SECURITY DEFINER, service_role-only
  // loader. The common-pattern INVOKER rule is for new user RPCs (027+), not
  // a silent security flip of this loader. Wrappers stay owner-only as in 024.
  it('H41: SECURITY INVOKER, owner-only, other user, anon and signed-out denied', () => {
    expect(loader).toContain('security definer');
    expect(loader).toContain("set search_path = ''");
    expect(sql).toContain(
      'revoke all on function public.sample_data_load(uuid, date, boolean) from public, anon, authenticated, service_role'
    );
    expect(sql).toContain(
      'grant execute on function public.sample_data_load(uuid, date, boolean) to service_role'
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.sample_data_load[^;]* to (anon|authenticated|public)/
    );
    expect(sql).not.toContain(
      'create or replace function public.load_my_sample_data'
    );
    expect(sql024).toContain('v_uid uuid := auth.uid()');
    expect(sql024).toContain('public.sample_data_load(v_uid, null, false)');
    expect(sql024).toContain('public.sample_data_clear(v_uid)');
    expect(selfTest).toContain(
      'authenticated was allowed to call sample_data_load'
    );
    expect(selfTest).toContain(
      'authenticated was allowed to call sample_data_clear'
    );
    expect(selfTest).toContain('a signed-out caller was not refused');
    expect(selfTest).toContain('anon was allowed to call load_my_sample_data');
    expect(selfTest).toContain("b''s own cp was cleared");
    expect(selfTest).toContain(
      'a browser role can call a loader it should not'
    );
    expect(selfTest).toContain(
      "has_function_privilege('anon', 'public.sample_data_load(uuid, date, boolean)', 'execute')"
    );
    expect(selfTest).toContain(
      "has_function_privilege('authenticated', 'public.load_my_sample_data()', 'execute')"
    );
  });

  it('does not change the 024 file that sample-data.test.mjs reads', () => {
    expect(raw024).toContain('Placeholder critical power');
    expect(raw024).toContain("'anchors', v_aid::text");
    expect(raw024).toContain("'sample', v_today - 56");
    expect(raw024).toMatch(/create function public\.sample_data_load\(/);
  });

  it('rollback restores the 024 loader body, including the 200 W insert', () => {
    expect(rollback.startsWith('begin;')).toBe(true);
    expect(rollback).toContain('commit;');
    expect(rollback.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(rollbackLoader).toContain('insert into public.anchors');
    expect(rollbackLoader).toContain('v_aid');
    expect(rollbackLoader).toContain('n_anchor := 1');
    expect(rollbackLoader).toContain(
      '[sample] placeholder critical power. replace it with your own test result.'
    );
    expect(rollback).not.toContain('drop function');
    expect(rollback).not.toContain('drop table');
    expect(rollback).not.toContain('delete from public.anchors');
  });

  it('self-test always rolls back its synthetic rows (SF026)', () => {
    expect(selfTest).toContain("errcode = 'sf026'");
    expect(selfTest).toContain("when sqlstate 'sf026'");
    expect(selfTest).toContain('f0260000-0000-4000-8000-00000000000a');
    expect(selfTest).toContain('f0260000-0000-4000-8000-00000000000b');
    expect(selfTest).toContain('insert into auth.users');
    expect(selfTest).not.toMatch(/@[a-z0-9.-]+\.[a-z]+/);
  });

  it('stages no health, vitals, labs, injuries or Strava rows', () => {
    for (const table of [
      'vitals',
      'bp_readings',
      'lab_results',
      'injuries',
      'coach_log',
      'strava_',
      'backup_snapshots',
    ]) {
      expect(loader).not.toContain(`public.${table}`);
    }
    expect(loader).not.toContain('strava_activity_id');
    expect(loader).not.toContain('benchmark_key');
  });
});
