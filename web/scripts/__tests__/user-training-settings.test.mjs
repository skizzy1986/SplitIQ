// @vitest-environment node
//
// Static contract for #819 slice S3: migration 027 creates
// user_training_settings and the two functions the new-user flow writes
// through (log_my_resting_hr, rate_my_session). CI has no database, so this
// reads the SQL from disk. The file is NOT applied anywhere yet; its own
// self-test (sentinel SF027) runs on apply, after Scott's yes. One block per
// acceptance criterion in S3's scope (Gate 2 brief §6a rows 8, 13 (storage),
// 16 (the rate_my_session half), 39 (depth), 41 and 42).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const raw = read('027_user_training_settings.sql');
const sql = strip(raw);
const rollback = strip(read('027_user_training_settings_rollback.sql'));
const manifest = JSON.parse(read('manifest.json'));

// The text before the self-test, and the self-test itself.
const selfTestStart = sql.lastIndexOf('do $$ declare ua constant uuid');
const body = sql.slice(0, selfTestStart);
const selfTest = sql.slice(selfTestStart);

const fnBody = (name) => {
  const start = body.indexOf(`create function public.${name}(`);
  const end = body.indexOf('$fn$;', start);
  return body.slice(start, end);
};
const rhr = fnBody('log_my_resting_hr');
const rate = fnBody('rate_my_session');

const COLUMN_LIST =
  'hr_path, hr_path_chosen_on, birth_year, time_zone, base_block_started_on, screening_completed_on, hr_caution, depth, updated_at';

describe('027 user_training_settings', () => {
  it('is one transaction that reloads the PostgREST schema cache', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(selfTestStart).toBeGreaterThan(0);
  });

  it('creates the table the brief names, one row per user, removed with the user', () => {
    expect(body).toContain('create table public.user_training_settings (');
    expect(body).toContain(
      'user_id uuid primary key references auth.users (id) on delete cascade default auth.uid()'
    );
    expect(body).toContain("hr_path text check (hr_path in ('strap', 'rpe'))");
    expect(body).toContain('hr_path_chosen_on date');
    expect(body).toContain(
      'birth_year smallint check (birth_year between 1900 and 2100)'
    );
    expect(body).toMatch(/time_zone text check \(time_zone ~ '/);
    expect(body).toContain('base_block_started_on date');
    expect(body).toContain('screening_completed_on date');
    expect(body).toContain('hr_caution boolean not null default false');
    expect(body).toContain(
      "depth text not null default 'simple' check (depth in ('simple', 'expert'))"
    );
    expect(body).toContain('created_at timestamptz not null default now()');
    expect(body).toContain('updated_at timestamptz not null default now()');
  });

  it('H8: hr_path is owner-only; denied to another user, anon and signed-out', () => {
    // RLS on, one owner policy for every operation, scoped to authenticated.
    expect(body).toContain(
      'alter table public.user_training_settings enable row level security;'
    );
    expect(body).toContain(
      'create policy user_training_settings_owner on public.user_training_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));'
    );
    expect(body.match(/create policy/g)).toHaveLength(1);
    // anon and public lose everything; nothing is granted back to them.
    expect(body).toMatch(
      /revoke all on table public\.user_training_settings from public, anon, authenticated, service_role;/
    );
    expect(body).not.toMatch(
      /grant [^;]* on table public\.user_training_settings to (anon|public)/
    );
    // The self-test proves each denial on a database at apply.
    for (const probe of [
      't8: rls let a see another account',
      't8: rls let b see another account',
      't8: b updated another account',
      't8: b deleted another account',
      't8: a signed-out caller could read settings',
      't8: anon could read settings',
      't8: a second row for one account was accepted',
    ]) {
      expect(selfTest).toContain(`027 self-test ${probe}`);
    }
    // And the grants are read back from the catalogue.
    expect(selfTest).toContain(
      "has_table_privilege('anon', 'public.user_training_settings', 'select')"
    );
  });

  // Gate 2 condition C1 and §3 "027": revoke once, then column-level grants,
  // so that 030 never has to (and must not) revoke at table level again.
  it('C1 grant order: one table-level revoke, then column-level insert and update only', () => {
    const revokeAt = body.indexOf(
      'revoke all on table public.user_training_settings'
    );
    const insertAt = body.indexOf('grant insert (');
    const updateAt = body.indexOf('grant update (');
    expect(revokeAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(revokeAt);
    expect(updateAt).toBeGreaterThan(revokeAt);
    expect(
      body.match(/revoke [^;]*on table public\.user_training_settings/g)
    ).toHaveLength(1);
    expect(body).toContain(
      `grant insert (${COLUMN_LIST}) on table public.user_training_settings to authenticated;`
    );
    expect(body).toContain(
      `grant update (${COLUMN_LIST}) on table public.user_training_settings to authenticated;`
    );
    expect(body).toContain(
      'grant select, delete on table public.user_training_settings to authenticated;'
    );
    // Never a table-level insert or update for a browser role: it would
    // override the column list.
    expect(body).not.toMatch(
      /grant [^;(]*\b(insert|update|all)\b[^;(]* on table public\.user_training_settings to (authenticated|anon|public)/
    );
    // The two columns the client must never write are not in either list.
    const lists = [
      ...body.matchAll(/grant (?:insert|update) \(([^)]*)\)/g),
    ].map((m) => m[1]);
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list).not.toMatch(/\buser_id\b/);
      expect(list).not.toMatch(/\bcreated_at\b/);
    }
    // 030's flag does not exist here, and so cannot be writable.
    expect(body).not.toContain('calibrate_from_strava');
    // The self-test shows the column grants work, and the others are refused.
    expect(selfTest).toContain(
      "update public.user_training_settings set depth = 'simple' where user_id = ua;"
    );
    expect(selfTest).toContain('027 self-test t8: created_at was writable');
    expect(selfTest).toContain('027 self-test t8: user_id was writable');
    expect(selfTest).toContain('027 self-test t8: user_id was insertable');
    expect(selfTest).toContain(
      "has_column_privilege('authenticated', 'public.user_training_settings', 'depth', 'update')"
    );
  });

  it('keeps service_role able to read and write, as the other server-readable tables do', () => {
    expect(body).toContain(
      'grant select, insert, update, delete on table public.user_training_settings to service_role;'
    );
  });

  it('H13 (storage): year of birth is a bounded, nullable column the owner can clear or delete', () => {
    expect(body).toContain(
      'birth_year smallint check (birth_year between 1900 and 2100)'
    );
    expect(body).not.toMatch(/birth_year smallint not null/);
    expect(selfTest).toContain(
      'update public.user_training_settings set birth_year = null where user_id = ua;'
    );
    expect(selfTest).toContain(
      'update public.user_training_settings set birth_year = 1899 where user_id = uc;'
    );
    expect(selfTest).toContain(
      '027 self-test t8: an owner delete removed the wrong rows'
    );
    // It is never copied into another table or a log by this file.
    // Only the column definition (twice, with its check) and the two grants.
    expect(body.match(/birth_year/g)).toHaveLength(4);
    expect(body).not.toMatch(/raise (notice|warning|log)/);
  });

  // The backfill statement in the migration and the copy in the self-test are
  // the same statement; the copy only adds the synthetic-user filter.
  it('H39: the depth backfill sets expert', () => {
    const between = (text, a, b) =>
      strip(text.slice(text.indexOf(a) + a.length, text.indexOf(b)));
    const real = between(raw, '-- BACKFILL START', '-- BACKFILL END');
    const copy = between(
      raw,
      '-- SELFTEST BACKFILL START',
      '-- SELFTEST BACKFILL END'
    );
    expect(real).toBe(
      "insert into public.user_training_settings (user_id, depth) select distinct a.user_id, 'expert' from public.anchors a where a.key = 'rowing_cp' and a.superseded_at is null and coalesce(a.source, '') <> 'sample' on conflict (user_id) do nothing;"
    );
    expect(copy).toBe(
      real.replace(
        "and coalesce(a.source, '') <> 'sample'",
        "and coalesce(a.source, '') <> 'sample' and a.user_id in (ua, ub, uc, ud, ue)"
      )
    );
    // The statement runs before the self-test, once, and never overwrites a row.
    expect(body.indexOf("select distinct a.user_id, 'expert'")).toBeGreaterThan(
      body.indexOf('create policy')
    );
    expect(real).toContain('on conflict (user_id) do nothing');
    // A live non-sample CP gets expert; sample-only, none and retired do not.
    expect(selfTest).toContain(
      "(ua, 'rowing_cp', '230', 'w', 'confirmed', 'manual', null)"
    );
    expect(selfTest).toContain(
      "(ub, 'rowing_cp', '200', 'w', 'provisional', 'sample', null)"
    );
    expect(selfTest).toContain(
      "(ud, 'rowing_cp', '210', 'w', 'unvalidated', 'manual', now())"
    );
    expect(selfTest).toContain(
      "(ue, 'rowing_cp', '240', 'w', 'unvalidated', null, null)"
    );
    expect(selfTest).toContain(
      '027 self-test t39: the depth backfill picked the wrong accounts'
    );
  });

  it('H41: both functions are SECURITY INVOKER with search_path = empty, owner-run and authenticated-only', () => {
    for (const [fn, sig] of [
      [rhr, 'log_my_resting_hr(date, integer)'],
      [rate, 'rate_my_session(bigint, integer, integer)'],
    ]) {
      expect(fn).toContain('security invoker');
      expect(fn).not.toContain('security definer');
      expect(fn).toContain("set search_path = ''");
      expect(fn).toContain('v_uid uuid := auth.uid();');
      expect(fn).toContain(
        "raise exception '" +
          sig.split('(')[0] +
          ": not signed in' using errcode = '28000';"
      );
      expect(body).toContain(
        `revoke all on function public.${sig} from public, anon, authenticated, service_role;`
      );
      expect(body).toContain(
        `grant execute on function public.${sig} to authenticated;`
      );
      expect(selfTest).toContain(`'public.${sig}', 'execute'`);
    }
    // The self-test asserts prosecdef = false for both.
    expect(selfTest).toContain('a 027 function must be security invoker');
    expect(selfTest).toContain('prosecdef from pg_catalog.pg_proc');
    // A signed-out caller and anon are each refused.
    for (const probe of [
      'rate: a signed-out caller was not refused',
      'rhr: a signed-out caller was not refused',
      'rate: anon was allowed to call rate_my_session',
      'rhr: anon was allowed to call log_my_resting_hr',
    ]) {
      expect(selfTest).toContain(`027 self-test ${probe}`);
    }
    // Neither function takes a user id: they only ever act for auth.uid().
    expect(rhr).not.toMatch(/p_user/);
    expect(rate).not.toMatch(/p_user/);
    // Error text never interpolates a value.
    expect(rhr).not.toMatch(/raise exception '[^']*%/);
    expect(rate).not.toMatch(/raise exception '[^']*%/);
  });

  it('log_my_resting_hr: one reading per date, 30-120 bpm, new rows manual, other columns kept', () => {
    expect(rhr).toContain('p_bpm is null or p_bpm < 30 or p_bpm > 120');
    expect(rhr).toContain("using errcode = '22023'");
    expect(rhr).toContain(
      "p_date > ((pg_catalog.now() at time zone 'utc')::date + 1)"
    );
    expect(rhr).toContain(
      "insert into public.vitals (user_id, date, rhr_bpm, source) values (v_uid, p_date, p_bpm, 'manual') on conflict (user_id, date) do update set rhr_bpm = coalesce(excluded.rhr_bpm, public.vitals.rhr_bpm);"
    );
    expect(rhr).not.toMatch(/delete from/);
    expect(rhr).toContain("pg_catalog.jsonb_build_object('status', 'saved')");
    for (const probe of [
      'rhr: a new reading was not saved as manual',
      'rhr: a second reading did not update only the resting hr',
      'rhr: a null date was accepted',
      'rhr: a future date was accepted',
      'rhr: a refused value changed the row',
    ]) {
      expect(selfTest).toContain(`027 self-test ${probe}`);
    }
  });

  it('H16: rate_my_session bounds avg HR and refuses linked rows', () => {
    expect(rate).toContain(
      'p_id bigint, p_srpe integer, p_avg_hr integer default null ) returns jsonb'
    );
    expect(rate).toContain('p_srpe is null or p_srpe < 1 or p_srpe > 10');
    expect(rate).toContain(
      'p_avg_hr is not null and (p_avg_hr < 30 or p_avg_hr > 230)'
    );
    // The caller's row only, locked, and another user's id reads as missing.
    expect(rate).toContain(
      'from public.sessions s where s.id = p_id and s.user_id = v_uid for update;'
    );
    expect(rate).toContain("'status', 'not_found'");
    // Planned and cancelled rows are never rated (H 20).
    expect(rate).toContain("v_status not in ('actual', 'completed', 'logged')");
    expect(rate).toContain("'status', 'not_completed'");
    // An average HR on a Strava-linked row is refused; nothing is written.
    expect(rate).toContain('p_avg_hr is not null and v_link is not null');
    expect(rate).toContain("'status', 'linked'");
    expect(rate.indexOf("'status', 'linked'")).toBeLessThan(
      rate.indexOf('update public.sessions')
    );
    // It updates srpe, and avg_hr only when given, and nothing else.
    expect(rate).toContain(
      'update public.sessions set srpe = p_srpe, avg_hr = coalesce(p_avg_hr, avg_hr) where id = p_id and user_id = v_uid;'
    );
    expect(rate.match(/update public\.sessions/g)).toHaveLength(1);
    // It returns {status} only, never row data.
    expect(rate).not.toMatch(/to_jsonb|row_to_json|returning/);
    expect(
      rate.match(/jsonb_build_object\('status', '[a-z_]+'\)/g)
    ).toHaveLength(4);
    for (const probe of [
      'rate: srpe alone was not saved',
      'rate: srpe and average hr were not saved',
      'rate: a rating without hr cleared the average hr',
      'rate: a planned or cancelled row was rated',
      'rate: a linked row accepted an average hr',
      'rate: srpe alone on a linked row failed',
      "rate: a reached b's session",
      'rate: a refused value changed the row',
    ]) {
      expect(selfTest).toContain(
        `027 self-test ${probe.replace("a reached b's", "a reached b''s")}`
      );
    }
    expect(selfTest).toContain('foreach v in array array[29, 231, 0, -5] loop');
    expect(selfTest).toContain(
      'foreach v in array array[0, 11, null, -1] loop'
    );
  });

  it('H42: reads no Strava or backup table, and nothing here logs a value', () => {
    expect(sql).not.toContain('strava_session_links');
    expect(sql).not.toContain('backup_snapshots');
    expect(sql).not.toMatch(/strava_tokens|strava_activity_cache/);
    // The only Strava column named is the importer's link id on sessions, to
    // test for "linked" without reading any Strava data.
    const uses = sql.match(/strava_\w+/g);
    expect(new Set(uses)).toEqual(new Set(['strava_activity_id']));
    expect(body).not.toMatch(/raise (notice|warning|log)/);
  });

  it('is self-testing: synthetic users, rolled back by SF027, then catalogue checks', () => {
    expect(selfTest).toContain("errcode = 'sf027'");
    expect(selfTest).toContain("exception when sqlstate 'sf027' then null;");
    for (const id of 'abcde') {
      expect(selfTest).toContain(`'f0270000-0000-4000-8000-00000000000${id}'`);
    }
    expect(selfTest).toContain(
      'insert into auth.users (id) values (ua), (ub), (uc), (ud), (ue);'
    );
    expect(selfTest).not.toMatch(/@[a-z]+\./);
    expect(selfTest).toContain(
      'user_training_settings must have exactly one policy'
    );
    expect(selfTest).toContain(
      'user_training_settings has the wrong table privileges'
    );
    expect(selfTest).toContain(
      'user_training_settings has the wrong column privileges'
    );
  });

  it('adds one table, one policy and two functions, and no trigger or third function', () => {
    expect(body.match(/create table /g)).toHaveLength(1);
    expect(body.match(/create policy /g)).toHaveLength(1);
    expect(body.match(/create function /g)).toHaveLength(2);
    expect(body).not.toMatch(
      /create (or replace )?trigger|create (or replace )?view/
    );
  });

  it('has a rollback that drops the functions then the table, and warns to export first', () => {
    expect(rollback.startsWith('begin;')).toBe(true);
    expect(rollback).toContain(
      'drop function if exists public.rate_my_session(bigint, integer, integer);'
    );
    expect(rollback).toContain(
      'drop function if exists public.log_my_resting_hr(date, integer);'
    );
    expect(rollback).toContain(
      'drop table if exists public.user_training_settings;'
    );
    expect(rollback.indexOf('drop function')).toBeLessThan(
      rollback.indexOf('drop table')
    );
    expect(rollback.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(read('027_user_training_settings_rollback.sql')).toMatch(
      /EXPORT FIRST/
    );
    // It does not touch vitals or sessions: saved readings and ratings stay.
    expect(rollback).not.toMatch(/public\.(vitals|sessions|anchors)/);
  });

  it('is recorded in the manifest as applied to dev, not production, for #819', () => {
    const entry = manifest.files.find(
      (f) => f.file === '027_user_training_settings.sql'
    );
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(819);
    expect(entry?.reason).toMatch(
      /dev only until scott says otherwise; this manifest tracks production/i
    );
    expect(entry?.reason).toMatch(/applied to dev, not production/i);
    expect(entry?.note).toMatch(/backfills depth 'expert'/i);
  });

  it('header says NOT auto-applied, covers the backfill and the grant-order rule', () => {
    const header = raw.split('begin;')[0];
    expect(header).toMatch(/NOT auto-applied/);
    expect(header).toMatch(/row-content backfill/i);
    expect(header).toMatch(/revoke at table level again/i);
    expect(header).toMatch(/H 41/);
  });
});
