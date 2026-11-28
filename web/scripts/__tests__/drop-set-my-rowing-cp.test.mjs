// @vitest-environment node
//
// Static contract for #819 slice S4b: migration 031 drops 025's legacy
// set_my_rowing_cp(integer) and nothing else. It is dev only and NEVER goes to
// production (docs/COORDINATION.md, "#819 lane call (decision 14)"). CI has no
// database, so this reads the SQL from disk. The file is NOT applied anywhere
// yet; its own catalogue self-test runs on apply, after Scott's yes. It was
// rehearsed on a local PostgreSQL 17 built from the dev structure baseline plus
// 022-028 (record in the PR body). One block per acceptance criterion in the
// S4b spec on #819.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const raw = read('031_drop_set_my_rowing_cp.sql');
const sql = strip(raw);
const rollbackRaw = read('031_drop_set_my_rowing_cp_rollback.sql');
const rollback = strip(rollbackRaw);
const sql025 = strip(read('025_set_my_rowing_cp.sql'));
const manifest = JSON.parse(read('manifest.json'));

const FN = 'public.set_my_rowing_cp(integer)';
const CP =
  'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)';
const HR =
  'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)';

// Everything between the apply guard and the commit.
const afterBegin = sql.slice(sql.indexOf('begin;'));
const selfTestStart = sql.lastIndexOf('do $$ declare fn_cp constant');
const selfTest = sql.slice(
  selfTestStart,
  sql.indexOf('commit;', selfTestStart)
);

// 025's function through its comment, as 025 wrote it.
const legacy = (text) =>
  text.slice(
    text.indexOf('create function public.set_my_rowing_cp('),
    text.indexOf("50-500 w.';") + "50-500 w.';".length
  );

describe('031 drop set_my_rowing_cp', () => {
  it('1. drops set_my_rowing_cp(integer), by full signature, and no other function', () => {
    const drops = [...sql.matchAll(/drop function ([^;]+);/g)].map((m) => m[1]);
    expect(drops).toEqual([FN]);
    // No IF EXISTS: an absent function must fail the apply, not pass silently.
    expect(sql).not.toMatch(/drop function if exists/);
    expect(sql).not.toMatch(/\bcascade\b/);
    expect(selfTest).toContain(
      "if to_regprocedure('public.set_my_rowing_cp(integer)') is not null then"
    );
  });

  it('2. leaves 028 alone and checks it is intact: invoker, empty search_path, authenticated only', () => {
    // 031 names 028's functions only to check them.
    expect(sql).not.toMatch(/drop function[^;]*save_my_/);
    expect(sql).not.toMatch(/(create|alter) (or replace )?function/);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/);
    for (const fn of [CP, HR])
      expect(selfTest).toContain(`'${fn}'::regprocedure`);
    expect(selfTest).toContain(
      "has_function_privilege('anon', fn_cp, 'execute')"
    );
    expect(selfTest).toContain(
      "has_function_privilege('service_role', fn_hr, 'execute')"
    );
    expect(selfTest).toContain(
      "not has_function_privilege('authenticated', fn_cp, 'execute')"
    );
    expect(selfTest).toContain('not prosecdef');
    expect(selfTest).toContain(`proconfig @> array['search_path=""']`);
  });

  it('3. changes nothing else: no row writes, no policy, table or column change; counts checked', () => {
    expect(sql).not.toMatch(/\b(delete from|insert into|truncate)\b/);
    expect(sql).not.toMatch(/\bupdate public\./);
    expect(sql).not.toMatch(/\b(create|alter|drop) policy\b/);
    expect(sql).not.toMatch(/\b(create|alter|drop) (table|index)\b/);
    expect(sql).not.toMatch(/\balter table\b/);
    // Counts taken before the drop (transaction-local, nothing written) ...
    expect(sql.indexOf("set_config('s031.functions'")).toBeGreaterThan(0);
    expect(sql.indexOf("set_config('s031.functions'")).toBeLessThan(
      sql.indexOf('drop function')
    );
    // ... and compared after it.
    expect(selfTest).toContain(
      "current_setting('s031.functions')::integer - 1"
    );
    expect(selfTest).toContain("current_setting('s031.tables')::integer");
    expect(selfTest).toContain("current_setting('s031.policies')::integer");
    for (const c of [
      'reason',
      'rule_id',
      'rule_version',
      'provenance',
      'locked',
    ])
      expect(selfTest).toContain(`'${c}'`);
    expect(selfTest).toContain("to_regclass('public.anchors_history') is null");
    expect(selfTest).toContain("policyname = 'anchors_owner'");
    expect(selfTest).toMatch(
      /where schemaname = 'public' and tablename = 'anchors'\) <> 1/
    );
  });

  it('4. refuses to apply, and raises, unless the function (and 028) are already there', () => {
    const guardStart = sql.indexOf('do $$ begin');
    const guard = sql.slice(guardStart, sql.indexOf('end $$;', guardStart));
    expect(guard).toContain(
      "if to_regprocedure('public.set_my_rowing_cp(integer)') is null then raise exception"
    );
    expect(guard).toContain('never production');
    expect(guard).toContain(`to_regprocedure('${CP}') is null`);
    expect(guard).toContain(`to_regprocedure('${HR}') is null`);
    expect(guard).toContain('apply 028_anchor_provenance first');
    // The guard comes before the drop, inside the same transaction.
    expect(guardStart).toBeLessThan(sql.indexOf('drop function'));
  });

  it('5. rollback recreates 025 verbatim, leaves 028 alone, and is never-to-prod', () => {
    // The function, revoke, grant and comment are exactly 025's text.
    expect(legacy(rollback)).toBe(legacy(sql025));
    expect(legacy(rollback)).toContain(
      'create function public.set_my_rowing_cp('
    );
    expect(legacy(rollback)).toContain(
      'grant execute on function public.set_my_rowing_cp(integer) to authenticated;'
    );
    // 028 is untouched; it is only read, to refuse on a project without it.
    expect(rollback).not.toMatch(/drop |alter |create (policy|index|table)/);
    // Outside 025's function body (which inserts and updates when called), the
    // rollback runs no row write of its own.
    expect(rollback.replace(legacy(rollback), '')).not.toMatch(
      /\b(delete from|insert into|update public\.|truncate)\b/
    );
    expect(rollback).toContain(
      `if to_regprocedure('${CP}') is null then raise exception '031 rollback: 028 is not on this project`
    );
    expect(rollback).toContain(
      "if to_regprocedure('public.set_my_rowing_cp(integer)') is not null then raise exception"
    );
    expect(rollback.startsWith('begin;')).toBe(true);
    expect(rollback.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(rollback.indexOf('commit;')).toBeLessThan(
      rollback.indexOf("notify pgrst, 'reload schema';")
    );
    expect(rollbackRaw).toMatch(/NOT auto-applied/);
    expect(rollbackRaw).toMatch(/NEVER production/);
    expect(rollbackRaw).toMatch(/verbatim/);
  });

  it('6. is recorded in the manifest as unapplied, dev only, never production, for #819', () => {
    const entry = manifest.files.find(
      (f) => f.file === '031_drop_set_my_rowing_cp.sql'
    );
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(819);
    expect(entry?.reason).toMatch(
      /dev only until scott says otherwise; this manifest tracks production/i
    );
    expect(entry?.reason).toMatch(/never production/i);
    expect(entry?.reason).toMatch(/031 never goes to production/i);
    expect(entry?.reason).toMatch(/not applied to production/i);
    expect(entry?.live).toBeUndefined();
  });

  it('7. header says NOT auto-applied, never production, names #819 S4b and writes no rows', () => {
    const header = raw.split('begin;')[0];
    expect(header).toMatch(/NOT auto-applied/);
    expect(header).toMatch(/NEVER production/);
    expect(header).toMatch(/031 never goes to\s+(--\s+)?production/);
    expect(header).toMatch(/#819, slice S4b/);
    expect(header).toMatch(/031 writes no rows/);
    expect(header).toMatch(/#839/);
    expect(header).toMatch(/Rollback: 031_drop_set_my_rowing_cp_rollback\.sql/);
  });

  it('8. is one transaction that reloads the PostgREST schema cache, and the self-test writes nothing', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(sql.indexOf('commit;')).toBeLessThan(
      sql.indexOf("notify pgrst, 'reload schema';")
    );
    // Catalogue only: no synthetic users, no sentinel to roll back.
    expect(afterBegin).not.toMatch(/auth\.users|set local role|sf031/);
  });

  it('the 025 file is unchanged by 031, and its manifest reason still matches', () => {
    expect(sql025).toContain('create function public.set_my_rowing_cp(');
    const entry = manifest.files.find(
      (f) => f.file === '025_set_my_rowing_cp.sql'
    );
    expect(entry?.reason).toMatch(
      /dev only, tester client, not for production/i
    );
  });
});
