// @vitest-environment node
//
// Static contract for #790: sessions uniqueness is per owner, and the one SQL
// caller that named the old key moves with it. CI has no database, so this
// reads the SQL from disk. The migration itself is not applied here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');

const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();

const sql = strip(
  readFileSync(
    resolve(migrationsDir, '022_sessions_unique_per_user.sql'),
    'utf8'
  )
);
const rawSql = readFileSync(
  resolve(migrationsDir, '022_sessions_unique_per_user.sql'),
  'utf8'
);
const manifest = JSON.parse(
  readFileSync(resolve(migrationsDir, 'manifest.json'), 'utf8')
);
const rollback = strip(
  readFileSync(
    resolve(migrationsDir, '022_sessions_unique_per_user_rollback.sql'),
    'utf8'
  )
);

describe('022 sessions unique per user', () => {
  it('adds the per-user key before it drops the global one, in one transaction', () => {
    const add = sql.indexOf(
      'add constraint sessions_user_date_label_key unique (user_id, date, label)'
    );
    const drop = sql.indexOf('drop constraint sessions_date_label_key');
    expect(add).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(add);
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
  });

  it('moves the strength rollup to the per-user key before the old key goes', () => {
    const fn = sql.indexOf(
      'create or replace function public.fn_sync_strength_session(w_id uuid)'
    );
    const drop = sql.indexOf('drop constraint sessions_date_label_key');
    expect(fn).toBeGreaterThan(-1);
    expect(fn).toBeLessThan(drop);
    const body = sql.slice(fn, sql.indexOf('$function$;', fn));
    expect(body).toContain('on conflict (user_id, date, label) do update set');
    expect(body).not.toContain('on conflict (date, label)');
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path to 'public'");
  });

  it('does not touch grants, so the function stays service_role only', () => {
    expect(sql).not.toContain('grant ');
    expect(sql).not.toContain('revoke ');
  });

  it('has a rollback that refuses when two owners share a date and label', () => {
    expect(rollback).toContain('group by date, label having count(*) > 1');
    expect(rollback).toContain('raise exception');
    expect(rollback).toContain(
      'add constraint sessions_date_label_key unique (date, label)'
    );
    expect(rollback).toContain('on conflict (date, label) do update set');
    expect(rollback).toContain('drop constraint sessions_user_date_label_key');
  });

  // Retro Gate 3 (#807, RC 2): the main criterion is behavioural, so the
  // migration proves it on a real database at apply time, on synthetic rows
  // that are always rolled back (sentinel SF022, the 019/020/023/024 pattern).
  it('self-tests two owners saving the same date and label, and rolls them back', () => {
    const start = sql.indexOf('ua constant uuid');
    expect(start).toBeGreaterThan(
      sql.indexOf('drop constraint sessions_date_label_key')
    );
    const block = sql.slice(
      start,
      sql.indexOf("exception when sqlstate 'sf022'", start)
    );
    expect(block).toContain('insert into auth.users (id) values (ua), (ub)');
    // Both owners insert the same date and label; neither may be refused.
    expect(
      block.match(/insert into public\.sessions/g)?.length
    ).toBeGreaterThanOrEqual(3);
    expect(block).toContain(
      'two owners could not save the same date and label'
    );
    // The same owner repeating it must still hit the per-owner key.
    expect(block).toContain('exception when unique_violation');
    expect(block).toContain('one owner saved the same date and label twice');
    expect(block).toContain("raise exception using errcode = 'sf022'");
  });

  // Retro Gate 3 (#807, RC 1): the record must say where 022 runs today.
  it('records the dev apply in the manifest, while production stays unapplied', () => {
    const entry = manifest.files.find(
      (e) => e.file === '022_sessions_unique_per_user.sql'
    );
    expect(entry.status).toBe('unapplied');
    expect(entry.reason).not.toMatch(/not applied to either project/i);
    expect(entry.reason).toMatch(/applied to SplitIQ dev/i);
    expect(entry.reason).toMatch(/25 Nov 2026/);
    expect(entry.reason).toMatch(/Scott/);
    expect(rawSql).not.toMatch(/DRAFT — not applied/);
  });
});
