// The decode worker's protocol, shared by every movement's worker entry: the
// entry hands over its bundled bin URLs at install and this answers the
// page's start message. Downloads are counted as they arrive and gunzipped
// off the main thread (decodeStream.js); each buffer goes back as a transfer,
// not a copy.
//
// A worker fetches only the URLs its entry bundled, never an address handed
// to it in a message, and answers only the page that created it. The two
// protocols share no helpers on purpose: the squat's worker ships serveBin
// alone, and every helper call would be bytes on each squat visit.
import { decodeStream } from './decodeStream.js';

/**
 * One bin (the squat). Posts `progress` in ~1% steps, `decoding` once, then
 * `{ type: 'done', buffer }`, or `{ type: 'error', message }`.
 * @param {{ url: string, bytes: number }} bin the bundled URL, and its pinned
 *   size: the progress denominator when the host sends no Content-Length
 */
export function serveBin({ url, bytes }) {
  self.onmessage = async (event) => {
    // A dedicated worker's messages carry an empty origin; anything else is
    // not from the page that created it. Only `type` is read.
    if (event.origin && event.origin !== self.location.origin) return;
    if (event.data?.type !== 'start') return;
    try {
      const res = await fetch(new URL(url, self.location.href));
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const header = Number(res.headers.get('Content-Length'));
      const total = header > 0 ? header : bytes;
      let last = 0;
      let decoding = false;
      const buffer = await decodeStream(res.body, total, (loaded) => {
        // ~1% steps; a message per network chunk floods the main thread.
        if (loaded - last >= total / 100 || loaded >= total) {
          last = loaded;
          self.postMessage({ type: 'progress', loaded, total });
        }
        if (!decoding && loaded >= total) {
          decoding = true;
          self.postMessage({ type: 'decoding' });
        }
      });
      self.postMessage({ type: 'done', buffer }, [buffer]);
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: String(error?.message || error),
      });
    }
  };
}

// Refused at install, so a malformed list stops the worker from starting
// (the page's onerror reports it) instead of failing every download later.
function checkBins(bins) {
  if (!Array.isArray(bins) || bins.length < 2) {
    throw new TypeError(
      'serveBins takes two or more bins; serveBin takes one.'
    );
  }
  const ids = new Set();
  for (const bin of bins) {
    const { id, url, bytes } = bin ?? {};
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new TypeError(
        `A bin id must be a distinct non-empty string, not ${JSON.stringify(id)}.`
      );
    }
    ids.add(id);
    if (typeof url !== 'string') throw new TypeError(`Bin "${id}" has no URL.`);
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new TypeError(
        `Bin "${id}" pins ${JSON.stringify(bytes)} bytes, not a positive integer.`
      );
    }
  }
}

/**
 * Two or more bins (the row: body and motion), fetched in parallel. Progress
 * is the bytes received across every bin against the sum of their pinned
 * sizes. Posts `decoding` once, then `{ type: 'done', buffers: { [id]:
 * ArrayBuffer } }` with every buffer transferred, or one
 * `{ type: 'error', message }` naming the bin that failed.
 * @param {{ id: string, url: string, bytes: number }[]} bins
 */
export function serveBins(bins) {
  checkBins(bins);
  const total = bins.reduce((sum, bin) => sum + bin.bytes, 0);
  self.onmessage = async (event) => {
    // The page that created the worker, and a start message, as serveBin.
    if (event.origin && event.origin !== self.location.origin) return;
    if (event.data?.type !== 'start') return;
    const controller = new AbortController();
    const received = {};
    let last = 0;
    let decoding = false;
    let failed = false;
    // serveBin's steps, over the bytes received across every bin.
    const onProgress = (id) => (loaded) => {
      received[id] = loaded;
      if (failed) return;
      const sum = Object.values(received).reduce((a, n) => a + n, 0);
      if (sum - last >= total / 100 || sum >= total) {
        last = sum;
        self.postMessage({ type: 'progress', loaded: sum, total });
      }
      if (!decoding && sum >= total) {
        decoding = true;
        self.postMessage({ type: 'decoding' });
      }
    };
    const load = async ({ id, url }) => {
      try {
        const res = await fetch(new URL(url, self.location.href), {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        return await decodeStream(res.body, total, onProgress(id));
      } catch (error) {
        // Aborted because another bin failed first: that failure is the one
        // reported, so this bin's AbortError is expected and dropped.
        if (controller.signal.aborted) return null;
        throw new Error(`${String(error?.message || error)} (${id})`, {
          cause: error,
        });
      }
    };
    try {
      const buffers = await Promise.all(bins.map(load));
      self.postMessage(
        {
          type: 'done',
          buffers: Object.fromEntries(bins.map((b, i) => [b.id, buffers[i]])),
        },
        buffers
      );
    } catch (error) {
      failed = true;
      controller.abort();
      self.postMessage({ type: 'error', message: error.message });
    }
  };
}
