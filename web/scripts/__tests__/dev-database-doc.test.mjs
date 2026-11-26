// @vitest-environment node
//
// Retro Gate 3 (#806, RC 1 / CR 1): docs/DEV_DATABASE.md must describe dev as
// it is now, not only as it was built. Every migration or function applied to
// dev after the build gets a line in its "Changes since the build" log, with
// the time, who approved it and the PR, and the current counts follow it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(
  resolve(here, '../../../docs/DEV_DATABASE.md'),
  'utf8'
);
const section = (heading) => {
  const start = doc.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = doc.indexOf('\n## ', start + 3);
  return doc.slice(start, next < 0 ? undefined : next);
};

describe('DEV_DATABASE.md', () => {
  it('logs 022, 023, 024 and the invite-signup deploy, each with time, approver and PR', () => {
    const log = section('Changes since the build');
    for (const [name, pr] of [
      ['022_sessions_unique_per_user', '#807'],
      ['023_invite_codes', '#808'],
      ['024_sample_data', '#812'],
      ['invite-signup', '#812'],
    ]) {
      const line = log.split('\n').find((l) => l.includes(name));
      expect(line, name).toBeTruthy();
      expect(line).toContain(pr);
      expect(line).toMatch(/25 Nov 2026/);
      expect(line).toMatch(/Scott/);
    }
  });

  it('gives the current counts, and keeps the build counts as history', () => {
    const now = section('Changes since the build');
    expect(now).toMatch(/24 public tables/);
    expect(now).toMatch(/23 policies/);
    expect(section('What dev holds')).not.toMatch(/and nothing else\./);
  });
});
