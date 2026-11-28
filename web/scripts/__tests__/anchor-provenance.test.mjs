// @vitest-environment node
//
// Static contract for #819 slice S4: migration 028 adds provenance and a lock
// to public.anchors and the two writers every anchor change goes through
// (save_my_cp, save_my_hr_anchor). CI has no database, so this reads the SQL
// from disk. The file is NOT applied anywhere yet; its own self-test
// (sentinel SF028) runs on apply, after Scott's yes. It was rehearsed on a
// local PostgreSQL 17 built from the dev structure baseline plus 022-027
// (record in the PR body). One block per acceptance criterion in the S4 spec
// on #819.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const raw = read('028_anchor_provenance.sql');
const sql = strip(raw);
const rollback = strip(read('028_anchor_provenance_rollback.sql'));
const rollbackRaw = read('028_anchor_provenance_rollback.sql');
const manifest = JSON.parse(read('manifest.json'));

const selfTestStart = sql.lastIndexOf('do $$ declare ua constant uuid');
const body = sql.slice(0, selfTestStart);
const selfTest = sql.slice(selfTestStart);

const fnBody = (name) => {
  const start = body.indexOf(`create function public.${name}(`);
  const end = body.indexOf('$fn$;', start);
  return body.slice(start, end);
};
const cp = fnBody('save_my_cp');
const hr = fnBody('save_my_hr_anchor');
const FNS = [
  [
    'save_my_cp',
    cp,
    'public.save_my_cp(integer, text, text, text, date, text, integer, jsonb, uuid, boolean)',
  ],
  [
    'save_my_hr_anchor',
    hr,
    'public.save_my_hr_anchor(text, integer, text, text, text, date, text, integer, jsonb, uuid, boolean)',
  ],
];

const REASONS = [
  'manual',
  'test',
  'onboarding',
  'observed_peak',
  'rhr_baseline',
  'maximal_effort',
  'maximal_effort_estimate',
  'cp_decrease_auto',
  'peak_expired',
  'proposal_accepted',
  'proposal_declined',
  'revert',
  'lock',
  'unlock',
];
const reasonList = REASONS.map((r) => `'${r}'`).join(', ');

describe('028 anchor provenance', () => {
  it('is one transaction that reloads the PostgREST schema cache', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(sql.indexOf('commit;')).toBeLessThan(sql.indexOf('notify pgrst'));
    expect(selfTestStart).toBeGreaterThan(0);
  });

  it('adds the five columns, additive, with no backfill and no row write', () => {
    expect(body).toContain('alter table public.anchors add column reason text');
    expect(body).toContain('add column rule_id text');
    expect(body).toContain('add column rule_version integer');
    expect(body).toContain('add column provenance jsonb');
    expect(body).toContain('add column locked boolean not null default false');
    // Decision 5: no backfill. Outside the two functions nothing writes rows.
    const outsideFns = body.replace(cp, '').replace(hr, '');
    expect(outsideFns).not.toMatch(
      /\binsert into\b|\bupdate public\.|\bdelete from\b/
    );
    expect(body).not.toMatch(/drop (table|column|function|policy)/);
  });

  it('A41: reason allow-list without age_estimate; provenance is an object', () => {
    expect(body).toContain(
      `constraint anchors_reason_check check ( reason is null or reason in ( ${reasonList} ) )`
    );
    // Only the self-test names it, to prove it is refused.
    expect(body).not.toContain('age_estimate');
    expect(selfTest).toContain('s7: age_estimate was accepted');
    expect(body).toContain(
      "constraint anchors_provenance_object check ( provenance is null or pg_catalog.jsonb_typeof(provenance) = 'object' )"
    );
    for (const [name, fn] of FNS) {
      expect(fn, name).toContain(
        `p_reason is not null and p_reason not in ( ${reasonList})`
      );
      expect(fn, name).toContain(
        "p_provenance is not null and pg_catalog.jsonb_typeof(p_provenance) <> 'object'"
      );
      expect(fn, name).toContain(
        "p_source not in ('test', 'manual', 'observed', 'estimate', 'auto', 'onboarding')"
      );
    }
  });

  it('adds the history index for "valid on date D"', () => {
    expect(body).toContain(
      'create index anchors_history on public.anchors (user_id, key, valid_from desc, created_at desc);'
    );
  });

  it('A42: one invoker function per anchor family; no cron or service role', () => {
    expect(body.match(/create function public\./g)).toHaveLength(2);
    for (const [name, fn, sig] of FNS) {
      expect(fn, name).toContain('security invoker');
      expect(fn, name).toContain("set search_path = ''");
      expect(fn, name).not.toContain('security definer');
      expect(body).toContain(
        `revoke all on function ${sig} from public, anon, authenticated, service_role;`
      );
      expect(body).toContain(
        `grant execute on function ${sig} to authenticated;`
      );
      expect(body).toContain(`comment on function ${sig} is`);
    }
    expect(sql).not.toMatch(
      /security definer|cron\.|service_role\s+bypass|set role service_role/
    );
    expect(body.match(/grant execute/g)).toHaveLength(2);
    expect(body).not.toMatch(/create (policy|trigger)/);
  });

  it('H41: only ever names the caller; signed-out refused', () => {
    for (const [name, fn] of FNS) {
      expect(fn, name).toContain('v_uid uuid := auth.uid();');
      expect(fn, name).toContain('if v_uid is null then raise exception');
      expect(fn, name).toContain("using errcode = '28000'");
      expect(fn, name).not.toMatch(/p_user_id/);
      // Every write is scoped to v_uid.
      expect(fn, name).toContain(
        'where id = v_live.id and user_id = v_uid and superseded_at is null'
      );
      expect(fn, name).toContain('values (v_uid,');
    }
  });

  it('H34: one-step retire and insert, W, history kept, valid_from clamped', () => {
    expect(cp).toContain(
      "pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended('rowing_cp:' || v_uid::text, 0))"
    );
    expect(hr).toContain(
      "pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended(p_key || ':' || v_uid::text, 0))"
    );
    for (const [name, fn] of FNS) {
      // One clock reading stamps both rows.
      expect(fn, name).toContain('v_now := pg_catalog.clock_timestamp();');
      expect(fn, name).toContain(
        'update public.anchors set superseded_at = v_now'
      );
      expect(fn, name).toMatch(/v_locked, v_now\) returning id into v_id;/);
      // The clamp: null or later than UTC + 1 is bad_date before the lock;
      // earlier than the live row is stored at the live row's date.
      expect(fn, name).toContain(
        "if p_valid_from is null or p_valid_from > ((pg_catalog.now() at time zone 'utc')::date + 1) then return pg_catalog.jsonb_build_object('status', 'bad_date'"
      );
      expect(fn.indexOf("'bad_date'")).toBeLessThan(
        fn.indexOf('pg_advisory_xact_lock')
      );
      expect(fn, name).toContain(
        'if v_has_live and p_valid_from < v_live.valid_from then v_valid := v_live.valid_from; v_clamped := true;'
      );
    }
    expect(cp).toContain("v_unit := 'w';");
    expect(cp).toContain('p_watts < 50 or p_watts > 500');
    expect(hr).toContain("v_unit := 'bpm';");
    expect(hr).toContain("(p_key = 'max_hr' and (p_bpm < 120 or p_bpm > 220))");
    expect(hr).toContain(
      "(p_key = 'resting_hr' and (p_bpm < 30 or p_bpm > 100))"
    );
    expect(hr).toContain("p_key not in ('max_hr', 'resting_hr')");
    // The SF028 cases.
    expect(selfTest).toContain('s3: backdated save was not clamped');
    expect(selfTest).toContain('s4: future date reported');
    expect(selfTest).toContain('s4: a refused date wrote a row');
  });

  it('A40: every change is a new row; nothing edited or deleted', () => {
    for (const [name, fn] of FNS) {
      expect(fn, name).not.toMatch(/\bdelete\b/);
      // The only update sets superseded_at.
      const updates = fn.match(/update public\.anchors set [a-z_]+/g);
      expect(updates, name).toEqual([
        'update public.anchors set superseded_at',
      ]);
    }
    expect(selfTest).toContain('s2: history was not kept');
    expect(selfTest).toContain('s6: expected six rowing_cp rows');
  });

  it('A32: one change from a double run; stale expected id', () => {
    for (const [name, fn] of FNS) {
      expect(fn, name).toContain(
        "if p_expected_live_id is not null and (not v_has_live or v_live.id <> p_expected_live_id) then return pg_catalog.jsonb_build_object('status', 'stale'"
      );
      expect(fn, name).toContain("'status', 'unchanged'");
    }
    expect(selfTest).toContain('s5: stale id reported');
    expect(selfTest).toContain('s5: stale or repeat wrote a row');
  });

  it('A50: locked means no change from a rule; unlock does not back-fill', () => {
    for (const [name, fn] of FNS) {
      expect(fn, name).toContain(
        "if v_has_live and v_live.locked and p_source in ('auto', 'estimate', 'observed') then return pg_catalog.jsonb_build_object('status', 'locked'"
      );
      // Lock and unlock rows carry the live value and date.
      expect(fn, name).toContain(
        "if p_reason in ('lock', 'unlock') then if not v_has_live then"
      );
      expect(fn, name).toContain('v_value := v_live.value;');
      expect(fn, name).toContain('v_valid := v_live.valid_from;');
      expect(fn, name).toContain("v_locked := (p_reason = 'lock');");
    }
    expect(selfTest).toContain('s6: a rule source replaced a locked row');
    expect(selfTest).toContain('s6: a test save dropped the lock');
  });

  it('H42: refusals name the field, never the value', () => {
    for (const [name, fn] of FNS) {
      const raises = fn.match(/raise exception '[^']*'[^;]*;/g) ?? [];
      expect(raises.length, name).toBeGreaterThan(5);
      for (const r of raises) {
        expect(r, name).not.toMatch(/%/);
        expect(r, name).toMatch(/using errcode = '(28000|22023)'/);
      }
    }
    expect(sql).not.toMatch(/strava_|backup_snapshots|from public\.sessions\b/);
  });

  it('is self-testing: synthetic users, rolled back by SF028, then catalogue checks', () => {
    expect(selfTest).toContain(
      "ua constant uuid := 'f0280000-0000-4000-8000-00000000000a'"
    );
    expect(selfTest).toContain(
      'insert into auth.users (id) values (ua), (ub);'
    );
    expect(selfTest).toContain('set local role authenticated;');
    expect(selfTest).toContain('set local role anon;');
    expect(selfTest).toContain("exception when sqlstate '28000' then null;");
    expect(selfTest).toContain(
      'exception when insufficient_privilege then null;'
    );
    expect(selfTest).toContain("s9: rls let one user see another''s anchors");
    expect(selfTest).toContain(
      "raise exception using errcode = 'sf028', message = 'rollback synthetic rows';"
    );
    expect(selfTest).toContain("exception when sqlstate 'sf028' then null;");
    expect(selfTest).toContain(
      'not prosecdef and proconfig @> array[\'search_path=""\']'
    );
    expect(selfTest).toContain("tablename = 'anchors') <> 1");
    expect(selfTest).toContain("to_regclass('public.anchors_history') is null");
  });

  it('leaves 025 alone (decision 11)', () => {
    expect(sql).not.toMatch(/drop function[^;]*set_my_rowing_cp/);
    expect(sql).not.toMatch(
      /create (or replace )?function public\.set_my_rowing_cp/
    );
    expect(rollback).not.toContain('set_my_rowing_cp');
  });

  it('has a rollback that drops only 028 objects, functions first, and warns to export', () => {
    expect(rollback.startsWith('begin;')).toBe(true);
    expect(rollback.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    const i = (s) => rollback.indexOf(s);
    expect(
      i('drop function if exists public.save_my_hr_anchor(')
    ).toBeGreaterThan(0);
    expect(i('drop function if exists public.save_my_cp(')).toBeGreaterThan(0);
    expect(i('drop function if exists public.save_my_cp(')).toBeLessThan(
      i('drop index if exists public.anchors_history;')
    );
    expect(i('drop index if exists public.anchors_history;')).toBeLessThan(
      i('alter table public.anchors drop column if exists locked')
    );
    for (const c of [
      'locked',
      'provenance',
      'rule_version',
      'rule_id',
      'reason',
    ]) {
      expect(rollback).toContain(`drop column if exists ${c}`);
    }
    expect(rollback).not.toMatch(
      /delete from|update public|truncate|drop table|drop policy/
    );
    expect(rollbackRaw).toMatch(/NOT auto-applied/);
    expect(rollbackRaw).toMatch(/EXPORT FIRST/);
  });

  it('is recorded in the manifest as applied to dev, not production, for #819', () => {
    const entry = manifest.files.find(
      (f) => f.file === '028_anchor_provenance.sql'
    );
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(819);
    expect(entry?.reason).toMatch(
      /^Dev only until Scott says otherwise; this manifest tracks production\./
    );
    expect(entry?.reason).toMatch(/applied to dev, not production/i);
    expect(entry?.reason).toMatch(/20261128010235/);
    expect(entry?.live).toBeUndefined();
  });

  it('header says NOT auto-applied, no backfill, and names the direct-write gap', () => {
    const header = raw.split('begin;')[0];
    expect(header).toMatch(/NOT auto-applied/);
    expect(header).toMatch(/writes no rows: no backfill/);
    expect(header).toMatch(/#839/);
    expect(header).toMatch(/Rollback: 028_anchor_provenance_rollback\.sql/);
  });
});
