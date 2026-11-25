// The decode worker's protocol, shared by every movement's worker entry: the
// entry hands over its bundled bin URLs at install and this answers the
// page's start message. Downloads are counted as they arrive and gunzipped
// off the main thread (decodeStream.js); each buffer goes back as a transfer,
// not a copy.
//
// A worker fetches only the URLs its entry bundled, never an address handed
// to it in a message, and answers only the page that created it.
import { decodeStream } from './decodeStream.js';

// A dedicated worker's messages carry an empty origin; anything else is not
// from the page that created it. Only `type` is read.
const isStart = (event) =>
  !(event.origin && event.origin !== self.location.origin) &&
  event.data?.type === 'start';

const messageOf = (error) => String(error?.message || error);

// ~1% steps: a message per network chunk floods the main thread. `decoding`
// goes once, when the last byte is in and only the gunzip is left.
function progressReporter(total) {
  let last = 0;
  let decoding = false;
  return (loaded) => {
    if (loaded - last >= total / 100 || loaded >= total) {
      last = loaded;
      self.postMessage({ type: 'progress', loaded, total });
    }
    if (!decoding && loaded >= total) {
      decoding = true;
      self.postMessage({ type: 'decoding' });
    }
  };
}

/**
 * One bin (the squat). Posts `progress`, `decoding` once, then
 * `{ type: 'done', buffer }`, or `{ type: 'error', message }`.
 * @param {{ url: string, bytes: number }} bin the bundled URL, and its pinned
 *   size: the progress denominator when the host sends no Content-Length
 */
export function serveBin({ url, bytes }) {
  self.onmessage = async (event) => {
    if (!isStart(event)) return;
    try {
      const res = await fetch(new URL(url, self.location.href));
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const header = Number(res.headers.get('Content-Length'));
      const total = header > 0 ? header : bytes;
      const buffer = await decodeStream(
        res.body,
        total,
        progressReporter(total)
      );
      self.postMessage({ type: 'done', buffer }, [buffer]);
    } catch (error) {
      self.postMessage({ type: 'error', message: messageOf(error) });
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
    if (!isStart(event)) return;
    const controller = new AbortController();
    const received = {};
    const report = progressReporter(total);
    let failed = false;
    const load = async ({ id, url }) => {
      try {
        const res = await fetch(new URL(url, self.location.href), {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        return await decodeStream(res.body, total, (loaded) => {
          received[id] = loaded;
          if (failed) return;
          report(Object.values(received).reduce((sum, n) => sum + n, 0));
        });
      } catch (error) {
        // Aborted because another bin failed first: that failure is the one
        // reported, so this bin's AbortError is expected and dropped.
        if (controller.signal.aborted) return null;
        throw new Error(`${messageOf(error)} (${id})`, { cause: error });
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
