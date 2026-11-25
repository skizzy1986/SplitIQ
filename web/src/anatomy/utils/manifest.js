// The structural check a movement's manifest passes before its buffers are
// read, and its buffers after. A broken or mismatched download fails here,
// with a message, rather than as a garbled model.
//
// The rules are the Python writer's and reader's (pipeline core/datafile.py):
// an array entry is an object with `o` and `t`, and must also carry `n`. A
// manifest without a bins lock indexes one buffer; one with a lock names each
// entry's bin in `b` and pins each bin's raw size and sha256. Each movement's
// binding says which timeline it reads, and the manifest must agree.
import { DTYPES } from './arrays.js';

// `cycle` is provisional: a repeating stroke rather than a rep (#757).
export const TIMELINE_KINDS = ['rep', 'cycle'];

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const SHA256 = /^[0-9a-f]{64}$/;

/** The array entries, by the Python predicate: an object with o and t. */
export const manifestEntries = (manifest) =>
  Object.entries(manifest).filter(
    ([, e]) => e !== null && typeof e === 'object' && 'o' in e && 't' in e
  );

const end = (e) => e.o + e.n * DTYPES[e.t].BYTES_PER_ELEMENT;

// The ids of a well-formed lock: distinct non-empty string ids, a raw byte
// count and a sha256 for each.
function lockedIds(bins) {
  if (!Array.isArray(bins)) throw new Error('The bins lock is malformed.');
  const ids = new Set();
  for (const bin of bins) {
    if (
      !isPlainObject(bin) ||
      typeof bin.id !== 'string' ||
      !bin.id ||
      !isCount(bin.rawBytes) ||
      !SHA256.test(bin.rawSha256)
    ) {
      throw new Error('The bins lock is malformed.');
    }
    if (ids.has(bin.id)) {
      throw new Error(`The bins lock repeats bin "${bin.id}".`);
    }
    ids.add(bin.id);
  }
  return ids;
}

/**
 * Throws with the first problem found.
 * @param {object} manifest the parsed manifest
 * @param {'rep'|'cycle'} kind the timeline the movement reads
 * @returns {string[]} the array entries' names
 */
export function checkManifest(manifest, kind) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('The manifest is not an object.');
  }
  const meta = manifest.meta;
  if (!meta || !Array.isArray(meta.S) || !Array.isArray(meta.readout)) {
    throw new Error('The manifest has no usable meta.');
  }
  if (meta.readout.length !== meta.S.length) {
    throw new Error('The manifest readout does not match its depth samples.');
  }
  if (!TIMELINE_KINDS.includes(kind)) {
    throw new Error(`Unknown timeline kind "${kind}".`);
  }
  const timeline = meta.timeline ?? 'rep';
  if (timeline !== kind) {
    throw new Error(`The manifest is a ${timeline} timeline, not ${kind}.`);
  }
  if (kind === 'cycle' && !isPlainObject(meta.stroke)) {
    throw new Error('The manifest has no stroke timeline (meta.stroke).');
  }
  const entries = manifestEntries(manifest);
  if (!entries.length) throw new Error('The manifest lists no arrays.');
  for (const [name, e] of entries) {
    if (!('n' in e)) throw new Error(`Array "${name}" has no n.`);
    if (!isCount(e.o) || !isCount(e.n)) {
      throw new Error(
        `Array "${name}" has a negative or non-integer offset or count.`
      );
    }
    if (!Object.hasOwn(DTYPES, e.t)) {
      throw new Error(`Array "${name}" has unknown dtype ${e.t}.`);
    }
    if (e.o % DTYPES[e.t].BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Array "${name}" is misaligned for ${e.t}.`);
    }
  }
  if (!('bins' in manifest)) {
    const binned = entries.find(([, e]) => 'b' in e);
    if (binned) {
      throw new Error(
        `Array "${binned[0]}" names bin "${binned[1].b}", but the manifest has no bins lock.`
      );
    }
  } else {
    const ids = lockedIds(manifest.bins);
    for (const [name, e] of entries) {
      if (!('b' in e)) throw new Error(`Array "${name}" has no bin.`);
      if (!ids.has(e.b)) {
        throw new Error(
          `Array "${name}" names bin "${e.b}", which the bins lock does not list.`
        );
      }
    }
  }
  return entries.map(([name]) => name);
}

/**
 * Every entry fits the one decompressed buffer. After checkManifest.
 * @param {object} manifest a manifest without a bins lock
 * @param {ArrayBuffer} buffer
 */
export function checkBuffer(manifest, buffer) {
  if ('bins' in manifest) {
    throw new Error('The manifest locks its bins.');
  }
  for (const [name, e] of manifestEntries(manifest)) {
    if (end(e) > buffer.byteLength) {
      throw new Error(`Array "${name}" runs past the end of the data.`);
    }
  }
}

/**
 * Each locked bin's buffer is the size the lock pins, and every entry fits
 * its own bin. After checkManifest. Sizes, not sha256: the committed files'
 * digests are pinned in Vitest, and a digest here would read every byte
 * again and need a secure context.
 * @param {object} manifest a manifest with a bins lock
 * @param {Record<string, ArrayBuffer>} buffers by bin id
 */
export function checkBuffers(manifest, buffers) {
  if (!('bins' in manifest)) {
    throw new Error(
      'The manifest has no bins lock: check it with checkBuffer.'
    );
  }
  const given = Object.keys(buffers).sort();
  const locked = manifest.bins.map((bin) => bin.id).sort();
  if (
    given.length !== locked.length ||
    given.some((id, i) => id !== locked[i])
  ) {
    throw new Error(
      `Bins given [${given.join(', ')}], the manifest locks [${locked.join(', ')}].`
    );
  }
  for (const { id, rawBytes } of manifest.bins) {
    const bytes = buffers[id].byteLength;
    if (bytes !== rawBytes) {
      throw new Error(
        `Bin "${id}" is ${bytes} bytes, the lock says ${rawBytes}.`
      );
    }
  }
  for (const [name, e] of manifestEntries(manifest)) {
    if (end(e) > buffers[e.b].byteLength) {
      throw new Error(`Array "${name}" runs past the end of bin "${e.b}".`);
    }
  }
}
