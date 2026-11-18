// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOBS,
  dockerRunArgs,
  playwrightVersion,
} from '../playwright-docker.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lock = JSON.parse(
  readFileSync(join(webRoot, 'package-lock.json'), 'utf8')
);
const workflow = readFileSync(
  join(webRoot, '../.github/workflows/e2e-web.yml'),
  'utf8'
);

const base = {
  version: '1.2.3',
  hostRepo: '/host/SplitIQ',
  job: 'visual',
  uid: 1000,
  gid: 1000,
  caFile: null,
};

describe('playwrightVersion', () => {
  it('reads the version from the real lockfile', () => {
    expect(playwrightVersion(lock)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads it from the same lockfile key e2e-web.yml uses', () => {
    expect(workflow).toContain("packages['node_modules/@playwright/test']");
  });

  it('throws when the lockfile has no @playwright/test entry', () => {
    expect(() => playwrightVersion({ packages: {} })).toThrow(/no @playwright/);
  });
});

describe('dockerRunArgs', () => {
  it('runs the pinned noble image that CI runs', () => {
    expect(dockerRunArgs(base)).toContain(
      'mcr.microsoft.com/playwright:v1.2.3-noble'
    );
    expect(workflow).toContain(
      'mcr.microsoft.com/playwright:v${{ needs.changes.outputs.pw }}-noble'
    );
  });

  it('bind-mounts the host path it is given, not the container path', () => {
    const args = dockerRunArgs(base);
    expect(args[args.indexOf('-v') + 1]).toBe('/host/SplitIQ:/repo');
  });

  it('shadows node_modules so the checkout copy is never overwritten', () => {
    expect(dockerRunArgs(base)).toContain('/repo/web/node_modules');
  });

  it.each(Object.entries(JOBS))('maps %s to npm run %s', (job, script) => {
    const cmd = dockerRunArgs({ ...base, job }).at(-1);
    expect(cmd).toMatch(new RegExp(`npm ci && npm run ${script};`));
  });

  it('keeps the test exit status after chowning', () => {
    const cmd = dockerRunArgs(base).at(-1);
    expect(cmd).toContain('chown -R 1000:1000 e2e');
    expect(cmd).toMatch(/status=\$\?.*exit \$status$/);
  });

  it('does not chown when the caller is root', () => {
    expect(dockerRunArgs({ ...base, uid: 0, gid: 0 }).at(-1)).not.toContain(
      'chown'
    );
  });

  it('mounts the proxy CA only when one is given', () => {
    expect(dockerRunArgs(base)).not.toContain(
      'NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.crt'
    );
    const args = dockerRunArgs({ ...base, caFile: '/root/ca.crt' });
    expect(args).toContain('/root/ca.crt:/tmp/proxy-ca.crt:ro');
    expect(args).toContain('NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.crt');
  });

  it('rejects an unknown job and names the valid ones', () => {
    expect(() => dockerRunArgs({ ...base, job: 'all' })).toThrow(
      /smoke, visual, visual:update/
    );
  });
});
