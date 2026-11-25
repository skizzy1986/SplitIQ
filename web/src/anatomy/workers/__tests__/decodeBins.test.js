// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { serveBins } from '../decodeBins.js';

// serveBin, the single-bin path, is covered by squat/__tests__/
// anatomyDecodeWorker.test.js, which drives the squat's real worker entry.

// The protocol assigns self.onmessage. Give it a self to talk to and a fetch
// to call, then drive it like the main thread would.
const posted = [];
globalThis.self = {
  postMessage: (msg, transfer) => posted.push({ msg, transfer }),
  location: {
    href: 'https://splitiq.test/assets/w.js',
    origin: 'https://splitiq.test',
  },
};
const START = { origin: '', data: { type: 'start' } };

let x = 7;
const PLAIN = {
  body: new Uint8Array(6000).map((_, i) => i % 251),
  // Incompressible, so the two bins' gzip sizes differ by a lot.
  motion: new Uint8Array(3000).map(
    () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24
  ),
};
const GZ = {
  body: new Uint8Array(gzipSync(PLAIN.body)),
  motion: new Uint8Array(gzipSync(PLAIN.motion)),
};
const BINS = [
  {
    id: 'body',
    url: '/assets/anatomy-body-Ab12Cd34.bin',
    bytes: GZ.body.length,
  },
  {
    id: 'motion',
    url: '/assets/row-motion-Ef56Gh78.bin',
    bytes: GZ.motion.length,
  },
];
const TOTAL = GZ.body.length + GZ.motion.length;

// Each bin's response, by its bundled path: 50-byte chunks of its gzip, or
// { status } for an HTTP failure, { failAfter } for a body that breaks after
// one chunk, { hang } for one that never ends until its request is aborted.
function serve(behaviour = {}) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const { id } = BINS.find((b) => b.url === url.pathname);
    const { status, failAfter, hang } = behaviour[id] ?? {};
    if (status) return { ok: false, status, body: null };
    const bytes = GZ[id];
    const body = new ReadableStream({
      start(c) {
        if (failAfter) {
          c.enqueue(bytes.slice(0, 50));
          c.error(new Error(failAfter));
          return;
        }
        for (let i = 0; i < bytes.length; i += 50) {
          c.enqueue(bytes.slice(i, i + 50));
        }
        // A real fetch errors its body with the abort reason.
        if (hang)
          init.signal.addEventListener('abort', () =>
            c.error(init.signal.reason)
          );
        else c.close();
      },
    });
    return { ok: true, status: 200, body };
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  posted.length = 0;
  self.onmessage = null;
});

describe('serveBins', () => {
  it('posts progress summed over both bins, decoding once, then transfers both buffers keyed by id', async () => {
    serveBins(BINS);
    serve();
    await self.onmessage(START);
    const types = posted.map((p) => p.msg.type);
    expect(types.filter((t) => t === 'decoding')).toHaveLength(1);
    expect(types.slice(-3)).toEqual(['progress', 'decoding', 'done']);
    const progress = posted
      .filter((p) => p.msg.type === 'progress')
      .map((p) => p.msg);
    expect(progress.at(-1)).toEqual({
      type: 'progress',
      loaded: TOTAL,
      total: TOTAL,
    });
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].loaded).toBeGreaterThan(progress[i - 1].loaded);
    }
    const done = posted.at(-1);
    expect(Object.keys(done.msg.buffers)).toEqual(['body', 'motion']);
    expect(new Uint8Array(done.msg.buffers.body)).toEqual(PLAIN.body);
    expect(new Uint8Array(done.msg.buffers.motion)).toEqual(PLAIN.motion);
    expect(done.transfer).toEqual([
      done.msg.buffers.body,
      done.msg.buffers.motion,
    ]);
  });

  it('fetches only the bundled URLs, same origin; ignores other origins and messages carrying a url', async () => {
    serveBins(BINS);
    serve();
    await self.onmessage({
      origin: 'https://evil.test',
      data: { type: 'start' },
    });
    await self.onmessage({ origin: '', data: { url: 'https://evil.test/x' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(posted).toEqual([]);

    await self.onmessage({
      origin: '',
      data: { type: 'start', url: 'https://evil.test/x' },
    });
    const targets = fetch.mock.calls.map(([url]) => url);
    for (const target of targets) {
      expect(target).toBeInstanceOf(URL);
      expect(target.origin).toBe('https://splitiq.test');
    }
    expect(targets.map((t) => t.pathname)).toEqual(BINS.map((b) => b.url));
    // One controller for the lot, so one failure can stop the rest.
    const [first, second] = fetch.mock.calls.map(([, init]) => init.signal);
    expect(first).toBe(second);
    expect(posted.at(-1).msg.type).toBe('done');
  });

  it('a failing bin aborts the other and posts one error naming the bin', async () => {
    serveBins(BINS);
    serve({ body: { hang: true }, motion: { status: 404 } });
    await self.onmessage(START);
    await settle();
    expect(posted.filter((p) => p.msg.type === 'error')).toEqual([
      {
        msg: { type: 'error', message: 'HTTP 404 (motion)' },
        transfer: undefined,
      },
    ]);
    expect(posted.map((p) => p.msg.type)).not.toContain('done');
    const [, bodyInit] = fetch.mock.calls.find(
      ([url]) => url.pathname === BINS[0].url
    );
    expect(bodyInit.signal.aborted).toBe(true);
  });

  it('names the bin whose download breaks mid-stream, and reports nothing after', async () => {
    serveBins(BINS);
    serve({ body: { failAfter: 'network' }, motion: { hang: true } });
    await self.onmessage(START);
    await settle();
    const errorAt = posted.findIndex((p) => p.msg.type === 'error');
    expect(posted[errorAt].msg).toEqual({
      type: 'error',
      message: 'network (body)',
    });
    expect(posted.slice(errorAt + 1)).toEqual([]);
  });

  it('refuses a malformed list at install: one bin, duplicate or missing ids, bad bytes', () => {
    const [body, motion] = BINS;
    expect(() => serveBins([body])).toThrow(TypeError);
    expect(() => serveBins([])).toThrow(/two or more bins/);
    expect(() => serveBins(undefined)).toThrow(TypeError);
    for (const id of ['body', '', undefined, 7]) {
      expect(() => serveBins([body, { ...motion, id }]), String(id)).toThrow(
        /distinct non-empty string/
      );
    }
    expect(() => serveBins([body, null])).toThrow(TypeError);
    expect(() => serveBins([body, { ...motion, url: undefined }])).toThrow(
      'Bin "motion" has no URL.'
    );
    for (const bytes of [0, -1, 1.5, '10', undefined]) {
      expect(
        () => serveBins([body, { ...motion, bytes }]),
        String(bytes)
      ).toThrow(/not a positive integer/);
    }
    // Nothing is installed: the worker never answers a start.
    expect(self.onmessage).toBeNull();
  });
});
