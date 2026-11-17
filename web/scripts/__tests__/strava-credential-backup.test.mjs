// @vitest-environment node
//
// Static guard for #629: no Strava credential or state table may ever appear in
// the nightly backup snapshot. backup_snapshot() (017) exports every public
// base table except a constant v_excluded array, and runs as postgres, which
// bypasses RLS — so the array is the ONLY thing keeping the OAuth tokens out of
// backup_snapshots. A later migration that redefines the function and drops a
// name would silently start copying credentials into the backup; this test
// fails CI first. CI has no database, so it reads the migration SQL from disk.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');

const STRAVA_TABLES = [
  'strava_tokens',
  'strava_oauth_state',
  'strava_sync_state',
  'strava_session_links',
  'strava_activity_cache',
];

// Comments carry prose that names tables and says "FORCE ROW LEVEL SECURITY";
// none of it may satisfy or trip a check.
const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ');

const DEFINES_BACKUP =
  /create\s+(or\s+replace\s+)?function\s+public\.backup_snapshot\s*\(\s*\)/;

const isRollback = (name) => name.endsWith('_rollback.sql');
const isForward = (name) =>
  /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && !isRollback(name);

/** The forward migration with the highest number whose SQL defines backup_snapshot(). */
function latestBackupDefinition(files) {
  const candidates = files
    .filter((f) => isForward(f.name) && DEFINES_BACKUP.test(strip(f.sql)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return candidates.at(-1) ?? null;
}

/** The names in the LAST v_excluded array of a backup_snapshot() definition. */
function excludedTables(sql) {
  const s = strip(sql);
  const start = s.search(DEFINES_BACKUP);
  if (start === -1) return null;
  const end = s.indexOf('$function$;', start);
  const body = s.slice(start, end === -1 ? undefined : end);
  const m = body.match(/v_excluded constant text\[\] := array\[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
}

const readAll = () =>
  readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    }));

describe('backup_snapshot() exclusion of the Strava tables', () => {
  const files = readAll();
  const latest = latestBackupDefinition(files);

  it('finds the latest forward migration that defines backup_snapshot()', () => {
    expect(latest).not.toBeNull();
    expect(isRollback(latest.name)).toBe(false);
    // 018 is the first to exclude the Strava tables; nothing older may win.
    expect(Number(latest.name.slice(0, 3))).toBeGreaterThanOrEqual(18);
  });

  it('excludes every Strava credential and state table, and backup_snapshots', () => {
    const excluded = excludedTables(latest.sql);
    expect(excluded).not.toBeNull();
    for (const t of [...STRAVA_TABLES, 'backup_snapshots']) {
      expect(excluded).toContain(t);
    }
    // sessions stays in the snapshot, whole (owner decision on #628).
    expect(excluded).not.toContain('sessions');
  });

  it('a later migration that drops a name is caught', () => {
    const dropped = files.concat({
      name: '099_later_backup_change.sql',
      sql: `create or replace function public.backup_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_excluded constant text[] := array['backup_snapshots', 'strava_oauth_state', 'strava_session_links', 'strava_sync_state'];
begin return '{}'::jsonb; end; $function$;`,
    });
    const picked = latestBackupDefinition(dropped);
    expect(picked.name).toBe('099_later_backup_change.sql');
    expect(excludedTables(picked.sql)).not.toContain('strava_tokens');
  });

  it('ignores rollback files, which restore older exclusion lists', () => {
    const withRollback = files.concat({
      name: '099_later_backup_change_rollback.sql',
      sql: `create or replace function public.backup_snapshot() returns jsonb as $function$
declare v_excluded constant text[] := array['backup_snapshots']; begin return null; end; $function$;`,
    });
    expect(latestBackupDefinition(withRollback).name).toBe(latest.name);
    // And the real 018 rollback, which restores 017's list, is not the pick.
    expect(
      files.some((f) => f.name === '018_strava_backup_exclusion_rollback.sql')
    ).toBe(true);
    expect(latest.name).not.toMatch(/_rollback\.sql$/);
  });
});

describe('012 keeps the Strava private tables policy-less and unforced', () => {
  const sql = strip(
    readFileSync(join(migrationsDir, '012_strava_integration.sql'), 'utf8')
  );

  it('never forces row level security', () => {
    expect(sql).not.toMatch(/alter table [^;]*force row level security/);
  });

  it('creates no policy on the credential, OAuth state or link tables', () => {
    for (const t of [
      'strava_tokens',
      'strava_oauth_state',
      'strava_session_links',
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`create policy [a-z0-9_"]+ on (public\\.)?${t}\\b`)
      );
    }
  });

  it('enables RLS on all three', () => {
    for (const t of [
      'strava_tokens',
      'strava_oauth_state',
      'strava_session_links',
    ]) {
      expect(sql).toContain(
        `alter table public.${t} enable row level security`
      );
    }
  });
});

describe('018 creates sessions_no_strava for agent sessions', () => {
  const sql = strip(
    readFileSync(join(migrationsDir, '018_strava_backup_exclusion.sql'), 'utf8')
  );
  const viewStart = sql.search(
    /create (or replace )?view public\.sessions_no_strava/
  );
  const view =
    viewStart === -1 ? '' : sql.slice(viewStart, sql.indexOf(';', viewStart));
  const selectList = view.slice(
    view.indexOf(' select ') + ' select '.length,
    view.indexOf(' from public.sessions ')
  );

  it('is a security_invoker view', () => {
    expect(view).not.toBe('');
    expect(view).toMatch(/with \(security_invoker = true\)/);
  });

  it('lists its columns explicitly and leaves out strava_activity_id', () => {
    expect(selectList).not.toBe('');
    expect(selectList).not.toMatch(/\*/);
    expect(selectList).not.toContain('strava_activity_id');
    for (const col of [
      's.id',
      's.date',
      's.user_id',
      'as avg_watts',
      'as avg_hr',
    ]) {
      expect(selectList).toContain(col);
    }
  });

  it('hides importer-inserted rows', () => {
    expect(view).toContain("l.origin is distinct from 'inserted'");
  });
});

describe('020 keeps the Strava activity cache private and short-lived', () => {
  const sql = strip(
    readFileSync(join(migrationsDir, '020_strava_activity_cache.sql'), 'utf8')
  );

  it('enables RLS and never forces it', () => {
    expect(sql).toContain(
      'alter table public.strava_activity_cache enable row level security'
    );
    expect(sql).not.toMatch(/alter table [^;]*force row level security/);
  });

  it('grants nothing to anon or authenticated, and revokes from both', () => {
    expect(sql).toContain(
      'revoke all on public.strava_activity_cache from public, anon, authenticated'
    );
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated)\b/);
  });

  it('creates no policy', () => {
    expect(sql).not.toMatch(/create policy/);
  });

  it('schedules the hourly sweep', () => {
    expect(sql).toContain("cron.schedule( 'strava-activity-cache-sweep'");
  });

  it('cascades from the link row, so every purge path removes it', () => {
    expect(sql).toMatch(
      /references public\.strava_session_links\(session_id\) on delete cascade/
    );
  });

  it('caps a row at seven days', () => {
    expect(sql).toContain("expires_at <= fetched_at + interval '168 hours'");
  });
});
