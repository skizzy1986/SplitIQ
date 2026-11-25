// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchVoiceCues,
  parseSums,
  sha256,
  verifyClips,
} from '../fetch-voice-cues.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FILES = {
  'dry/go-1.mp3': 'one',
  'enc/go-1.mp3': 'two',
  'tech/work-1.mp3': 'three',
  'tones/hit.mp3': 'four',
};
const sums = new Map(
  Object.entries(FILES).map(([p, body]) => [p, sha256(Buffer.from(body))])
);

let work;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'cues-test-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function writeClips(dir, files = FILES) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
}

// The "tarball" is any bytes; `untar` is injected and writes the clips.
function harness({ files = FILES, tarballBytes = 'tarball', sha } = {}) {
  const bytes = Buffer.from(tarballBytes);
  return {
    root: join(work, 'public'),
    config: {
      url: 'https://example.test/voice-cues-v1.tar.gz',
      asset: 'voice-cues-v1.tar.gz',
      sha256: sha ?? sha256(bytes),
    },
    sums,
    fetchFn: vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    })),
    untar: vi.fn((_file, dest) => writeClips(dest, files)),
    log: vi.fn(),
  };
}

describe('fetch-voice-cues', () => {
  it('parses sha256sum lines and rejects anything else', () => {
    expect(parseSums(`${'a'.repeat(64)}  dry/x.mp3\n`).get('dry/x.mp3')).toBe(
      'a'.repeat(64)
    );
    expect(() => parseSums('nonsense\n')).toThrow(/Bad checksum line/);
  });

  it('keeps the committed checksum list in step with the pinned tarball config', () => {
    const config = JSON.parse(
      readFileSync(resolve(here, '../voice-cues.json'), 'utf8')
    );
    expect(config.url).toContain(
      `/releases/download/${config.tag}/${config.asset}`
    );
    expect(config.sha256).toMatch(/^[0-9a-f]{64}$/);
    const list = parseSums(
      readFileSync(resolve(here, '../voice-cues.sha256'), 'utf8')
    );
    expect(list.size).toBe(782);
    expect(
      [...list.keys()].every((p) =>
        /^(dry|enc|tech|tones)\/[\w-]+\.mp3$/.test(p)
      )
    ).toBe(true);
  });

  it('downloads, verifies and places the clips', async () => {
    const h = harness();
    expect(await fetchVoiceCues(h)).toBe('fetched');
    expect(verifyClips(h.root, sums)).toEqual([]);
    expect(h.fetchFn).toHaveBeenCalledWith(h.config.url);
  });

  it('does not download again when the clips are already in place', async () => {
    const h = harness();
    writeClips(h.root);
    expect(await fetchVoiceCues(h)).toBe('present');
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it('repairs a changed clip by fetching again', async () => {
    const h = harness();
    writeClips(h.root);
    writeFileSync(join(h.root, 'dry/go-1.mp3'), 'tampered');
    expect(await fetchVoiceCues(h)).toBe('fetched');
    expect(readFileSync(join(h.root, 'dry/go-1.mp3'), 'utf8')).toBe('one');
  });

  it('fails on a download error and places nothing', async () => {
    const h = harness();
    h.fetchFn.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchVoiceCues(h)).rejects.toThrow(/HTTP 404/);
    expect(existsSync(h.root)).toBe(false);
  });

  it('fails when the tarball does not match the pinned checksum', async () => {
    const h = harness({ sha: 'f'.repeat(64) });
    await expect(fetchVoiceCues(h)).rejects.toThrow(
      /tarball checksum mismatch/
    );
    expect(h.untar).not.toHaveBeenCalled();
    expect(existsSync(h.root)).toBe(false);
  });

  it('fails when a clip is wrong, missing or unexpected, and places nothing', async () => {
    for (const files of [
      { ...FILES, 'dry/go-1.mp3': 'wrong' },
      Object.fromEntries(Object.entries(FILES).slice(1)),
      { ...FILES, 'dry/extra.mp3': 'extra' },
    ]) {
      const h = harness({ files });
      await expect(fetchVoiceCues(h)).rejects.toThrow(/clip checks failed/);
      expect(existsSync(h.root)).toBe(false);
    }
  });
});
