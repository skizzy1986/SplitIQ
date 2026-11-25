// @vitest-environment node
//
// Static contract for #799: the sample-data migration stays dev-only, labelled,
// deterministic, health-free and ledger-driven. CI has no database, so this
// reads the SQL from disk. The file is not applied here; its own self-test runs
// on apply, and the same file was rehearsed in a local PGlite built from the
// real dev baseline.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ').trim();
const read = (name) => readFileSync(resolve(migrationsDir, name), 'utf8');

const raw = read('024_sample_data.sql');
const sql = strip(raw);
const rollback = strip(read('024_sample_data_rollback.sql'));
const manifest = JSON.parse(read('manifest.json'));

// The loader body, without the self-test that deliberately touches many tables.
const loaderStart = sql.indexOf('create function public.sample_data_load(');
const loaderEnd = sql.indexOf('create function public.sample_data_clear(');
const loader = sql.slice(loaderStart, loaderEnd);

describe('024 sample data', () => {
  it('is one transaction and refuses to apply without 022', () => {
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toContain('commit;');
    expect(sql).toContain("conname = 'sessions_user_date_label_key'");
    expect(sql).toContain('apply 022_sessions_unique_per_user first');
  });

  it('is recorded in the manifest as unapplied, for #799', () => {
    const entry = manifest.files.find((f) => f.file === '024_sample_data.sql');
    expect(entry?.status).toBe('unapplied');
    expect(entry?.issue).toBe(799);
  });

  it('is deterministic: no random, no clock beyond the load day, no reads of existing rows', () => {
    expect(loader).not.toMatch(/random\(|gen_random_uuid|setseed|tablesample/);
    expect(loader).toContain("md5('sample-workout|'");
    expect(loader).toContain("md5('sample-set|'");
    // The only rows it reads are the user check, its own ledger, the guard
    // against loading over a tester's own data, the catalogue of exercises and
    // the rows it just wrote.
    const reads = [...loader.matchAll(/from public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(
      new Set([
        'sample_data_rows',
        'sessions',
        'strength_workouts',
        'exercises',
        'strength_sets',
        'anchors',
      ])
    );
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

  it('labels every staged row and marks it in the ledger', () => {
    expect(loader).toContain("'[sample] ' || t.label");
    expect(loader).toContain("'[sample] ' || case r.tpl");
    expect(loader).toContain("'sample' from timed t");
    expect(loader).toMatch(/'sessions', ins\.id::text/);
    expect(loader).toContain("'strength_workouts', v_wid::text");
    expect(loader).toContain("'anchors', v_aid::text");
    expect(loader).toContain("'sample', v_today - 56");
  });

  it('refuses a second load and an account that already has data', () => {
    expect(loader).toContain("'already_loaded'");
    expect(loader).toContain("'has_own_data'");
    expect(loader).toContain('not p_force');
  });

  it('clears exactly what the ledger lists, never by label or by user alone', () => {
    const start = sql.indexOf('create function public.sample_data_clear(');
    const end = sql.indexOf('create function public.load_my_sample_data(');
    const clear = sql.slice(start, end);
    expect(clear.match(/using public\.sample_data_rows l/g)).toHaveLength(3);
    expect(clear).toContain("l.table_name = 'strength_workouts'");
    expect(clear).toContain("l.table_name = 'sessions'");
    expect(clear).toContain("l.table_name = 'anchors'");
    expect(clear).not.toMatch(/like '\[sample\]/);
    expect(clear).not.toContain('truncate');
  });

  it('keeps the ledger and the loaders away from the browser roles', () => {
    expect(sql).toContain(
      'alter table public.sample_data_rows enable row level security'
    );
    expect(sql).toContain('using (user_id = (select auth.uid()))');
    expect(sql).toContain(
      'grant select on table public.sample_data_rows to authenticated'
    );
    expect(sql).toContain(
      'grant execute on function public.sample_data_load(uuid, date, boolean) to service_role'
    );
    expect(sql).toContain(
      'grant execute on function public.sample_data_clear(uuid) to service_role'
    );
    expect(sql).toContain(
      'grant execute on function public.load_my_sample_data() to authenticated'
    );
    expect(sql).toContain(
      'grant execute on function public.clear_my_sample_data() to authenticated'
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.sample_data_(load|clear)[^;]* to (anon|authenticated|public)/
    );
    expect(sql.match(/security definer/g)?.length).toBe(4);
    expect(sql.match(/set search_path = ''/g)?.length).toBe(4);
  });

  it('wrappers act only on the caller, from the verified JWT', () => {
    expect(sql).toContain('v_uid uuid := auth.uid()');
    expect(sql).toContain('public.sample_data_load(v_uid, null, false)');
    expect(sql).toContain('public.sample_data_clear(v_uid)');
  });

  it('has a rollback that clears every sample row before it drops the ledger', () => {
    const clear = rollback.indexOf('perform public.sample_data_clear(u)');
    const drop = rollback.indexOf(
      'drop table if exists public.sample_data_rows'
    );
    expect(clear).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(clear);
    expect(rollback).toContain(
      'drop function if exists public.sample_data_load(uuid, date, boolean)'
    );
    expect(rollback).toContain(
      'drop function if exists public.clear_my_sample_data()'
    );
  });

  it('has a self-test that always rolls back', () => {
    expect(sql).toContain("errcode = 'sf024'");
    expect(sql).toContain("exception when sqlstate 'sf024'");
  });
});
