// Fetches the voice-cue clips (#785) into public/audio/cues/ before a build.
// The 782 mp3s (about 15 MiB) are not in git. They are one GitHub release
// asset, so the fetch needs no secret. Two checks, both against files that are
// in git: the tarball's SHA-256 (voice-cues.json), then every clip's SHA-256
// (voice-cues.sha256). Nothing is placed unless both pass, and the folder must
// hold exactly the listed files, no more.
//
// npm runs it as `prebuild`. A failed download or a checksum mismatch fails
// the build: an app that quietly ships without its clips is worse than a red
// build. Set SPLITIQ_SKIP_VOICE_CUES=1 to skip (offline work); the cues then
// stay silent, which the player reports and survives.
//
//   npm run cues:fetch
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIP_DIRS = ['dry', 'enc', 'tech', 'tones'];

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// "<hex>  <path>" lines, as sha256sum writes them.
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new Error(`Bad checksum line: ${line}`);
    sums.set(m[2], m[1]);
  }
  return sums;
}

function listClips(dir) {
  const found = [];
  for (const sub of CLIP_DIRS) {
    const base = join(dir, sub);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) found.push(`${sub}/${name}`);
  }
  return found.sort();
}

// Returns the problems found: missing, changed or unexpected files. Empty
// means `dir` holds exactly the listed clips.
export function verifyClips(dir, sums) {
  const problems = [];
  for (const [path, want] of sums) {
    const file = join(dir, path);
    if (!existsSync(file)) problems.push(`missing ${path}`);
    else if (sha256(readFileSync(file)) !== want)
      problems.push(`changed ${path}`);
  }
  for (const path of listClips(dir)) {
    if (!sums.has(path)) problems.push(`unexpected ${path}`);
  }
  return problems;
}

export async function fetchVoiceCues({
  root = resolve(here, '..', 'public', 'audio', 'cues'),
  config = JSON.parse(readFileSync(join(here, 'voice-cues.json'), 'utf8')),
  sums = parseSums(readFileSync(join(here, 'voice-cues.sha256'), 'utf8')),
  fetchFn = globalThis.fetch,
  untar = (file, dest) => execFileSync('tar', ['-xzf', file, '-C', dest]),
  log = console.log,
} = {}) {
  if (verifyClips(root, sums).length === 0) {
    log(`voice cues: ${sums.size} clips already in place, checksums match`);
    return 'present';
  }
  log(`voice cues: fetching ${config.url}`);
  const res = await fetchFn(config.url);
  if (!res.ok)
    throw new Error(`voice cues: HTTP ${res.status} for ${config.url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== config.sha256) {
    throw new Error(
      `voice cues: tarball checksum mismatch (want ${config.sha256}, got ${got})`
    );
  }
  const work = mkdtempSync(join(tmpdir(), 'voice-cues-'));
  try {
    const tarball = join(work, config.asset);
    writeFileSync(tarball, bytes);
    const out = join(work, 'out');
    mkdirSync(out);
    untar(tarball, out);
    const problems = verifyClips(out, sums);
    if (problems.length) {
      throw new Error(
        `voice cues: ${problems.length} clip checks failed, first: ${problems[0]}`
      );
    }
    mkdirSync(root, { recursive: true });
    for (const sub of CLIP_DIRS) {
      rmSync(join(root, sub), { recursive: true, force: true });
      // A copy, not a rename: the temp dir can be on another device.
      cpSync(join(out, sub), join(root, sub), { recursive: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  log(`voice cues: ${sums.size} clips fetched and verified`);
  return 'fetched';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.SPLITIQ_SKIP_VOICE_CUES === '1') {
    console.warn('voice cues: skipped (SPLITIQ_SKIP_VOICE_CUES=1)');
  } else {
    fetchVoiceCues().catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
  }
}
