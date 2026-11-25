// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  TIMELINE_KINDS,
  checkBuffer,
  checkBuffers,
  checkManifest,
  manifestEntries,
} from '../manifest.js';
import { arrayEntries } from '../arrays.js';

const ASSETS = join(process.cwd(), 'src/squat/assets');
const squatManifest = JSON.parse(
  readFileSync(join(ASSETS, 'squat-manifest.json'), 'utf8')
);

// The squat's form: one bin, no ids.
const tiny = () => ({
  a: { o: 0, n: 2, t: '<f4' },
  b: { o: 8, n: 4, t: '|u1' },
  meta: { S: [0, 1], readout: [{}, {}] },
});
// The Python writer's two-bin form: `b` on every entry, offsets within each
// bin, and a lock of each bin's raw bytes and sha256.
const twoBins = () => ({
  pos: { o: 0, n: 4, t: '<f4', b: 'body' },
  idx: { o: 16, n: 8, t: '<u2', b: 'body' },
  curve: { o: 0, n: 6, t: '<f4', b: 'motion' },
  meta: {
    timeline: 'cycle',
    S: [0, 0.5],
    readout: [{}, {}],
    stroke: { catch: 0, finish: 0.5 },
  },
  bins: [
    { id: 'body', rawBytes: 32, rawSha256: 'a'.repeat(64) },
    { id: 'motion', rawBytes: 24, rawSha256: '0123456789abcdef'.repeat(4) },
  ],
});
const buffers = (body = 32, motion = 24) => ({
  body: new ArrayBuffer(body),
  motion: new ArrayBuffer(motion),
});

describe('checkManifest: the rep timeline in one bin', () => {
  it('passes the tiny manifest, with and without a buffer', () => {
    expect(checkManifest(tiny(), 'rep')).toEqual(['a', 'b']);
    expect(() => checkBuffer(tiny(), new ArrayBuffer(12))).not.toThrow();
  });

  it('passes the real squat manifest and bin, 71 arrays', () => {
    const raw = gunzipSync(readFileSync(join(ASSETS, 'squat-anatomy.bin')));
    const buffer = raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength
    );
    expect(checkManifest(squatManifest, 'rep')).toHaveLength(71);
    expect(() => checkBuffer(squatManifest, buffer)).not.toThrow();
  });

  it("keeps today's four messages", () => {
    expect(() => checkManifest(null, 'rep')).toThrow(
      'The manifest is not an object.'
    );
    expect(() => checkManifest({}, 'rep')).toThrow(
      'The manifest has no usable meta.'
    );
    expect(() =>
      checkManifest({ meta: { S: [0], readout: 1 } }, 'rep')
    ).toThrow('The manifest has no usable meta.');
    expect(() =>
      checkManifest({ meta: { S: [0, 1], readout: [{}] } }, 'rep')
    ).toThrow('The manifest readout does not match its depth samples.');
    expect(() =>
      checkManifest({ meta: { S: [0], readout: [{}] } }, 'rep')
    ).toThrow('The manifest lists no arrays.');
  });
});

describe('checkManifest: the timeline kind', () => {
  it('lists the two kinds', () => {
    expect(TIMELINE_KINDS).toEqual(['rep', 'cycle']);
  });

  it('throws on an unknown kind', () => {
    expect(() => checkManifest(tiny(), 'stroke')).toThrow(
      'Unknown timeline kind "stroke".'
    );
    expect(() => checkManifest(tiny())).toThrow(
      'Unknown timeline kind "undefined".'
    );
  });

  it('fails a cycle manifest read as a rep, and passes one with no timeline', () => {
    const cycle = tiny();
    cycle.meta.timeline = 'cycle';
    expect(() => checkManifest(cycle, 'rep')).toThrow(
      'The manifest is a cycle timeline, not rep.'
    );
    expect(tiny().meta.timeline).toBeUndefined();
    expect(() => checkManifest(tiny(), 'rep')).not.toThrow();
  });

  it('requires meta.timeline and meta.stroke for a cycle', () => {
    expect(() => checkManifest(tiny(), 'cycle')).toThrow(
      'The manifest is a rep timeline, not cycle.'
    );
    const m = tiny();
    m.meta.timeline = 'cycle';
    expect(() => checkManifest(m, 'cycle')).toThrow(
      'The manifest has no stroke timeline (meta.stroke).'
    );
    m.meta.stroke = [];
    expect(() => checkManifest(m, 'cycle')).toThrow(/no stroke timeline/);
    m.meta.stroke = { catch: 0 };
    expect(checkManifest(m, 'cycle')).toEqual(['a', 'b']);
  });
});

describe('checkManifest: array entries', () => {
  const withEntry = (entry) => ({ ...tiny(), a: { ...tiny().a, ...entry } });

  it('counts {o, t} as an entry, by the Python predicate, and requires its n', () => {
    const m = { ...tiny(), c: { o: 12, t: '|u1' } };
    expect(manifestEntries(m).map(([k]) => k)).toEqual(['a', 'b', 'c']);
    expect(() => checkManifest(m, 'rep')).toThrow('Array "c" has no n.');
  });

  it('ignores what is not an object with o and t', () => {
    const m = {
      ...tiny(),
      noT: { o: 0, n: 1 },
      list: [1, 2],
      nothing: null,
      word: 'o t',
    };
    expect(manifestEntries(m).map(([k]) => k)).toEqual(['a', 'b']);
  });

  it('selects the same arrays in the squat manifest as the array readers', () => {
    expect(manifestEntries(squatManifest).map(([k]) => k)).toEqual(
      arrayEntries(squatManifest).map(([k]) => k)
    );
  });

  it.each([
    [{ o: -4 }],
    [{ o: 1.5 }],
    [{ o: '4' }],
    [{ n: -1 }],
    [{ n: 2.5 }],
    [{ n: null }],
  ])('refuses a negative or non-integer offset or count: %j', (entry) => {
    expect(() => checkManifest(withEntry(entry), 'rep')).toThrow(
      'Array "a" has a negative or non-integer offset or count.'
    );
  });

  it('refuses an unknown dtype, inherited names included', () => {
    expect(() => checkManifest(withEntry({ t: '<f8' }), 'rep')).toThrow(
      'Array "a" has unknown dtype <f8.'
    );
    expect(() => checkManifest(withEntry({ t: 'constructor' }), 'rep')).toThrow(
      'Array "a" has unknown dtype constructor.'
    );
  });

  it('refuses a misaligned offset', () => {
    expect(() => checkManifest(withEntry({ o: 2 }), 'rep')).toThrow(
      'Array "a" is misaligned for <f4.'
    );
  });
});

describe('one bin', () => {
  it('fails an entry that names a bin when there is no lock', () => {
    const m = tiny();
    m.b.b = 'body';
    expect(() => checkManifest(m, 'rep')).toThrow(
      'Array "b" names bin "body", but the manifest has no bins lock.'
    );
  });

  it('fails an entry past the end of the buffer', () => {
    expect(() => checkBuffer(tiny(), new ArrayBuffer(11))).toThrow(
      'Array "b" runs past the end of the data.'
    );
  });

  it('checkBuffer refuses a locked manifest', () => {
    expect(() => checkBuffer(twoBins(), new ArrayBuffer(64))).toThrow(
      'The manifest locks its bins.'
    );
  });
});

describe('two bins (the Python form)', () => {
  it('passes the structure', () => {
    expect(checkManifest(twoBins(), 'cycle')).toEqual(['pos', 'idx', 'curve']);
  });

  it('fails an entry with no bin, or a bin the lock does not list', () => {
    const noBin = twoBins();
    delete noBin.idx.b;
    expect(() => checkManifest(noBin, 'cycle')).toThrow(
      'Array "idx" has no bin.'
    );
    const unlisted = twoBins();
    unlisted.curve.b = 'skin';
    expect(() => checkManifest(unlisted, 'cycle')).toThrow(
      'Array "curve" names bin "skin", which the bins lock does not list.'
    );
  });

  it.each([
    ['a lock that is not a list', (m) => (m.bins = { body: {} })],
    ['a bin that is not an object', (m) => (m.bins[1] = 'motion')],
    ['a non-string id', (m) => (m.bins[1].id = 2)],
    ['an empty id', (m) => (m.bins[1].id = '')],
    ['negative rawBytes', (m) => (m.bins[0].rawBytes = -1)],
    ['non-integer rawBytes', (m) => (m.bins[0].rawBytes = 3.5)],
    ['an uppercase sha256', (m) => (m.bins[0].rawSha256 = 'A'.repeat(64))],
    ['a short sha256', (m) => (m.bins[0].rawSha256 = 'a'.repeat(63))],
    ['a missing sha256', (m) => delete m.bins[0].rawSha256],
  ])('fails a malformed lock: %s', (_, spoil) => {
    const m = twoBins();
    spoil(m);
    expect(() => checkManifest(m, 'cycle')).toThrow(
      'The bins lock is malformed.'
    );
  });

  it('fails a lock that repeats a bin', () => {
    const m = twoBins();
    m.bins[1].id = 'body';
    expect(() => checkManifest(m, 'cycle')).toThrow(
      'The bins lock repeats bin "body".'
    );
  });
});

describe('checkBuffers', () => {
  it('passes when every bin is the locked size and every entry fits', () => {
    expect(() => checkBuffers(twoBins(), buffers())).not.toThrow();
  });

  it('fails bins missing or extra', () => {
    expect(() =>
      checkBuffers(twoBins(), { body: new ArrayBuffer(32) })
    ).toThrow('Bins given [body], the manifest locks [body, motion].');
    expect(() =>
      checkBuffers(twoBins(), { ...buffers(), skin: new ArrayBuffer(1) })
    ).toThrow(
      'Bins given [body, motion, skin], the manifest locks [body, motion].'
    );
    expect(() =>
      checkBuffers(twoBins(), {
        body: new ArrayBuffer(32),
        skin: new ArrayBuffer(24),
      })
    ).toThrow('Bins given [body, skin], the manifest locks [body, motion].');
  });

  it('fails a buffer whose size is not the locked rawBytes', () => {
    expect(() => checkBuffers(twoBins(), buffers(31))).toThrow(
      'Bin "body" is 31 bytes, the lock says 32.'
    );
  });

  it('fails an entry that runs past the end of its own bin', () => {
    const m = twoBins();
    m.curve.n = 7;
    expect(checkManifest(m, 'cycle')).toHaveLength(3);
    expect(() => checkBuffers(m, buffers())).toThrow(
      'Array "curve" runs past the end of bin "motion".'
    );
  });

  it('refuses a manifest with no lock', () => {
    expect(() => checkBuffers(tiny(), buffers())).toThrow(
      'The manifest has no bins lock: check it with checkBuffer.'
    );
  });
});
