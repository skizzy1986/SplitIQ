import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEALTH_NETWORK_ONLY_ROUTE, HEALTH_TABLES } from '../healthRoute.mjs';

const BASE = 'https://abcdefgh.supabase.co/rest/v1';

// Workbox RegExpRoute semantics for a cross-origin URL: the match must start
// at index 0 of the href (workbox-routing RegExpRoute.js).
const workboxMatches = (re, href) => {
  const m = re.exec(href);
  return Boolean(m) && m.index === 0;
};

describe('HEALTH_NETWORK_ONLY_ROUTE', () => {
  const re = HEALTH_NETWORK_ONLY_ROUTE.urlPattern;

  it('is NetworkOnly with no cache name', () => {
    expect(HEALTH_NETWORK_ONLY_ROUTE.handler).toBe('NetworkOnly');
    expect(HEALTH_NETWORK_ONLY_ROUTE.options).toBeUndefined();
  });

  it.each(HEALTH_TABLES)(
    'matches a PostgREST read of %s the way Workbox matches',
    (table) => {
      expect(
        workboxMatches(re, `${BASE}/${table}?select=id&order=id.desc`)
      ).toBe(true);
      expect(workboxMatches(re, `${BASE}/${table}`)).toBe(true);
    }
  );

  it('does not match other tables', () => {
    for (const t of ['vitals', 'sessions', 'bp_readings_archive', 'anchors']) {
      expect(workboxMatches(re, `${BASE}/${t}?select=*`)).toBe(false);
    }
    expect(workboxMatches(re, 'https://evil.example/rest/v1/injuries')).toBe(
      false
    );
  });

  // The unanchored NetworkFirst rule never matched a cross-origin URL
  // (RegExpRoute requires index 0) and is gone. Re-adding that pattern, or a
  // supabase-api cache in front of this route, would undo #526.
  it('is registered, and vite.config.js has no supabase REST cache', () => {
    const src = readFileSync(join(process.cwd(), 'vite.config.js'), 'utf8');
    const health = src.indexOf('HEALTH_NETWORK_ONLY_ROUTE,');
    expect(health).toBeGreaterThan(-1);
    expect(src).not.toContain("cacheName: 'supabase-api'");
    expect(src).not.toContain('supabase\\.co\\/rest');
  });
});
