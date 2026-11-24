// @vitest-environment node
//
// Static contract for #216: the duration_min migration stays in lockstep with
// the JS parser and does not loosen the sessions_no_strava agent-session view.
// CI has no database, so this reads the SQL from disk. The migration itself
// is not applied here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../supabase/migrations');

const strip = (text) =>
  text.replace(/--.*$/gm, '').toLowerCase().replace(/\s+/g, ' ');

const sql = strip(
  readFileSync(resolve(migrationsDir, '021_sessions_duration_min.sql'), 'utf8')
);
const rollback = strip(
  readFileSync(
    resolve(migrationsDir, '021_sessions_duration_min_rollback.sql'),
    'utf8'
  )
);

describe('021 sessions duration_min', () => {
  it('adds an immutable generated column and does not replace the function in place later', () => {
    expect(sql).toContain(
      'create or replace function public.session_duration_to_minutes(d text)'
    );
    expect(sql).toContain('immutable');
    expect(sql).toContain('strict');
    expect(sql).toContain('parallel safe');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      'generated always as (public.session_duration_to_minutes(duration)) stored'
    );
    expect(sql).toContain(
      'grant execute on function public.session_duration_to_minutes(text) to anon, authenticated, service_role'
    );
  });

  it('parses hh:mm:ss before mm:ss and keeps leftover shapes null', () => {
    const hh = sql.indexOf("regexp_match(s, '^(\\d+):(\\d{2}):(\\d{2})$')");
    const mm = sql.indexOf("regexp_match(s, '^(\\d+):(\\d{2})$')");
    expect(hh).toBeGreaterThan(-1);
    expect(mm).toBeGreaterThan(hh);
    expect(sql).toContain("session_duration_to_minutes('1:02:03')");
    expect(sql).toContain("session_duration_to_minutes('120:00')");
    expect(sql).toContain("session_duration_to_minutes('~15m') is not null");
    expect(sql).toContain(
      "session_duration_to_minutes('20-30min') is not null"
    );
  });

  it('appends duration_min on sessions_no_strava and keeps the view contract', () => {
    const viewStart = sql.search(
      /create (or replace )?view public\.sessions_no_strava/
    );
    expect(viewStart).toBeGreaterThan(-1);
    const view = sql.slice(viewStart, sql.indexOf(';', viewStart));
    expect(view).toMatch(/with \(security_invoker = true\)/);
    const selectList = view.slice(
      view.indexOf(' select ') + ' select '.length,
      view.indexOf(' from public.sessions ')
    );
    expect(selectList).not.toMatch(/\*/);
    expect(selectList).not.toContain('strava_activity_id');
    expect(selectList.trim().endsWith('s.duration_min')).toBe(true);
    expect(sql).toContain(
      'revoke all on public.sessions_no_strava from public, anon, authenticated'
    );
  });

  it('rolls back the view, then the column, then the function', () => {
    const view = rollback.indexOf(
      'create or replace view public.sessions_no_strava'
    );
    const col = rollback.indexOf(
      'alter table public.sessions drop column if exists duration_min'
    );
    const fn = rollback.indexOf(
      'drop function if exists public.session_duration_to_minutes(text)'
    );
    expect(view).toBeGreaterThan(-1);
    expect(col).toBeGreaterThan(view);
    expect(fn).toBeGreaterThan(col);
    expect(rollback).not.toContain('s.duration_min');
  });
});
