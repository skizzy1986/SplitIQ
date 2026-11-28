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
  it('logs every post-build apply to dev, each with time, approver and PR', () => {
    const log = section('Changes since the build');
    for (const [name, pr, when] of [
      ['022_sessions_unique_per_user', '#807', '25 Nov 2026'],
      ['023_invite_codes', '#808', '25 Nov 2026'],
      ['024_sample_data', '#812', '25 Nov 2026'],
      ['invite-signup', '#812', '25 Nov 2026'],
      ['025_set_my_rowing_cp', '#817', '26 Nov 2026'],
    ]) {
      const line = log.split('\n').find((l) => l.includes(name));
      expect(line, name).toBeTruthy();
      expect(line).toContain(pr);
      expect(line).toMatch(new RegExp(when));
      expect(line).toMatch(/Scott/);
    }
  });

  it('gives the current counts, and keeps the build counts as history', () => {
    const now = section('Changes since the build');
    expect(now).toMatch(/25 public tables/);
    expect(now).toMatch(/24 policies/);
    expect(section('What dev holds')).not.toMatch(/and nothing else\./);
  });
  it('logs the 027 apply with time, approver, PR and the rolled-back first attempt', () => {
    const log = section('Changes since the build');
    const line = log
      .split('\n')
      .find((l) => l.includes('027_user_training_settings'));
    expect(line).toBeTruthy();
    expect(line).toContain('#826');
    expect(line).toMatch(/27 Nov 2026/);
    expect(line).toMatch(/Scott/);
    expect(line).toMatch(/rolled back/);
    expect(log).toMatch(/Apply record: 027/);
    expect(log).toMatch(/20261127060130/);
    expect(log).toMatch(/25 public tables/);
    expect(log).toMatch(/24 policies/);
    expect(doc).not.toMatch(/Pending, not applied yet/);
  });

  it('logs the 028 apply with time, approver, PR and pinned counts', () => {
    const log = section('Changes since the build');
    const line = log
      .split('\n')
      .find((l) => l.includes('028_anchor_provenance'));
    expect(line).toBeTruthy();
    expect(line).toContain('#840');
    expect(line).toMatch(/28 Nov 2026/);
    expect(line).toMatch(/Scott/);
    expect(log).toMatch(/Apply record: 028/);
    expect(log).toMatch(/20261128010235/);
    expect(log).toMatch(/25 public tables/);
    expect(log).toMatch(/24 policies/);
    expect(log).toMatch(/30 public functions/);
  });
});
