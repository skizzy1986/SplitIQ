// Runs a Playwright CI job inside the exact image CI uses, so a result here means
// the same as a result in e2e-web.yml. Baselines in particular are only valid
// from that image: glyph rasterisation differs between images, so a PNG made
// anywhere else fails CI forever.
//
//   npm run e2e:docker -- smoke | visual | visual:update
//
// It works in both dev boxes (docs/DEV_ENVIRONMENTS.md):
//   - the desktop dev container, whose Docker CLI drives the HOST's daemon
//     (docker-outside-of-docker), so the bind mount must name the host path —
//     LOCAL_WORKSPACE_FOLDER, exported by .devcontainer/devcontainer.json;
//   - a Claude Code cloud session, which ships dockerd but does not start it,
//     and whose egress proxy re-signs TLS with its own CA, so the CA is mounted
//     into the container for npm.
//
// The image tag is read from package-lock.json exactly as e2e-web.yml's
// `changes` job does, so it cannot drift from CI on a Dependabot bump.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');

// The cloud session's egress proxy CA (see its /root/.ccr/README.md).
const CLOUD_PROXY_CA = '/root/.ccr/ca-bundle.crt';

export const JOBS = {
  smoke: 'test:e2e',
  visual: 'test:visual',
  'visual:update': 'test:visual:update',
};

export function playwrightVersion(lock) {
  const version = lock?.packages?.['node_modules/@playwright/test']?.version;
  if (!version) {
    throw new Error('no @playwright/test version in web/package-lock.json');
  }
  return version;
}

export function dockerRunArgs({ version, hostRepo, job, uid, gid, caFile }) {
  const script = JOBS[job];
  if (!script) {
    throw new Error(
      `unknown job "${job}" — expected one of: ${Object.keys(JOBS).join(', ')}`
    );
  }
  const args = [
    'run',
    '--rm',
    '-v',
    `${hostRepo}:/repo`,
    // An anonymous volume over node_modules: the image's `npm ci` installs into
    // it and the checkout's own node_modules is never overwritten by root.
    '-v',
    '/repo/web/node_modules',
    '-w',
    '/repo/web',
    '-e',
    'HOME=/root',
    '-e',
    'CI=1',
  ];
  if (caFile) {
    args.push(
      '-v',
      `${caFile}:/tmp/proxy-ca.crt:ro`,
      '-e',
      'NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.crt'
    );
  }
  // The container runs as root, so hand what it wrote back to the caller —
  // otherwise regenerated baselines are root-owned in the checkout, and the
  // webServer's `vite build` leaves a root-owned dist/ that breaks the next
  // `npm run build` outside the container.
  const chown =
    uid > 0
      ? `; chown -R ${uid}:${gid} e2e test-results playwright-report dist 2>/dev/null`
      : '';
  args.push(
    `mcr.microsoft.com/playwright:v${version}-noble`,
    'sh',
    '-c',
    `npm ci && npm run ${script}; status=$?${chown}; exit $status`
  );
  return args;
}

const daemonUp = () =>
  spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

// A cloud session has dockerd installed but not running, and runs as root.
// Start it on demand rather than in the environment's setup script, so sessions
// that never touch Docker do not pay for a daemon.
async function ensureDaemon() {
  if (daemonUp()) return;
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
  if (!cloud || process.getuid?.() !== 0) {
    throw new Error(
      'no Docker daemon reachable. In the dev container, check Docker Desktop is running on the host; elsewhere, start Docker first.'
    );
  }
  // A fresh 0700 directory, not a fixed /tmp path: this runs as root, and a
  // predictable name could be pre-planted as a symlink to redirect the write.
  const logPath = join(mkdtempSync(join(tmpdir(), 'dockerd-')), 'dockerd.log');
  const log = openSync(logPath, 'wx');
  spawn('dockerd', [], { detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    if (daemonUp()) return;
  }
  throw new Error(`dockerd did not come up in 30 s — see ${logPath}`);
}

async function main() {
  const job = process.argv[2];
  const lock = JSON.parse(
    readFileSync(join(webRoot, 'package-lock.json'), 'utf8')
  );
  const args = dockerRunArgs({
    version: playwrightVersion(lock),
    hostRepo: process.env.LOCAL_WORKSPACE_FOLDER || repoRoot,
    job,
    uid: process.getuid?.() ?? 0,
    gid: process.getgid?.() ?? 0,
    caFile:
      process.env.CLAUDE_CODE_REMOTE === 'true' && existsSync(CLOUD_PROXY_CA)
        ? CLOUD_PROXY_CA
        : null,
  });
  await ensureDaemon();
  console.log(`docker ${args.join(' ')}`);
  execFileSync('docker', args, { stdio: 'inherit' });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(`e2e:docker: ${err.message}`);
    process.exit(1);
  });
}
