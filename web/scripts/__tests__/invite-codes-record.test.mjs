// @vitest-environment node
//
// Retro Gate 3 (#808, RC 2): the repo's record of 023 and the invite-signup
// function must say where they run today. 023 is applied to SplitIQ dev only
// and the function is deployed there; production has neither. The manifest
// tracks production, so 023 stays `unapplied` with a reason that says so.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('023 and invite-signup record', () => {
  it('records the dev apply in the manifest, while production stays unapplied', () => {
    const manifest = JSON.parse(read('supabase/migrations/manifest.json'));
    const entry = manifest.files.find((e) => e.file === '023_invite_codes.sql');
    expect(entry.status).toBe('unapplied');
    expect(entry.reason).not.toMatch(/not applied to either project/i);
    expect(entry.reason).toMatch(/applied to SplitIQ dev/i);
    expect(entry.reason).toMatch(/25 Nov 2026/);
    expect(entry.reason).toMatch(/never production/i);
  });

  it('drops the stale "not applied" header from the migration', () => {
    const sql = read('supabase/migrations/023_invite_codes.sql');
    expect(sql).not.toMatch(/DRAFT — not applied/);
    expect(sql).toMatch(/Applied to SplitIQ dev only, 25 Nov 2026/);
  });

  it('says in the function README that dev runs a deployed build', () => {
    const readme = read('supabase/functions/invite-signup/README.md');
    expect(readme).toMatch(/Deployed to SplitIQ dev/);
    expect(readme).toMatch(/INVITE_SIGNUP_ENABLED/);
  });
});
