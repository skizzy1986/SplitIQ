import { captureError } from '../utils/sentry.js';

// Plays the voice cues (#785) through Web Audio. Not <audio>: a buffer source
// triggers fast and is scheduled on the audio clock, so a lead and its line
// sit 220 ms apart to the sample. Whether a Web Audio context in the Android
// WebView pauses another app's music (Spotify) is not known; the Settings test
// cue exists to find out on a real phone.
//
// One voice at a time. A speaking cue is never cut except by `finish` and
// cancelAll(). A new P0-P2 cue while speaking waits as the single pending cue;
// a P3 cue is dropped. A cue past its ttlMs when the slot frees is discarded.
// Tones never play over speech, except the end sting that follows the finish
// line (cue.tone.after).

// Decoded audio is 32-bit float: about 187 KB a second at 48 kHz. 24 MiB is
// about two minutes. Not measured on a phone yet (WIRING-SPEC manual test M8).
export const CACHE_MAX_BYTES = 24 * 1024 * 1024;
export const TONE_GAIN_DB = 0;
export const TONE_MIN_GAP_MS = 400;
export const END_STING_DELAY_MS = 150;
export const TONE_TO_VOICE_MS = 60;
const START_AHEAD_S = 0.03;
const FREE_SLACK_MS = 250;

function bytesOf(buffer) {
  return buffer.length * buffer.numberOfChannels * 4;
}

export function createCuePlayer({
  getContext,
  fetchFn = (...args) => fetch(...args),
  nowMs = () => globalThis.performance.now(),
  report = captureError,
  base = '/audio/cues',
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const listeners = new Set();
  let index = null;
  let indexLoading = null;
  let gains = null;
  let slot = null;
  let pending = null;
  let muted = false;
  let lastToneAt = -Infinity;
  const toneSources = new Set();

  function gainsFor(ctx) {
    if (gains?.ctx === ctx) return gains;
    const voice = ctx.createGain();
    const tone = ctx.createGain();
    tone.gain.value = 10 ** (TONE_GAIN_DB / 20);
    voice.connect(ctx.destination);
    tone.connect(ctx.destination);
    gains = { ctx, voice, tone };
    return gains;
  }

  async function getIndex() {
    if (index) return index;
    if (!indexLoading) {
      indexLoading = (async () => {
        try {
          const res = await fetchFn(`${base}/cues.index.json`);
          if (!res.ok) throw new Error(`cue index HTTP ${res.status}`);
          index = await res.json();
        } catch (err) {
          report(err, { source: 'cuePlayer', clip: 'cues.index.json' });
        }
        indexLoading = null;
        return index;
      })();
    }
    return indexLoading;
  }

  function evict() {
    let total = 0;
    for (const b of cache.values()) total += bytesOf(b);
    for (const [id, b] of cache) {
      if (total <= CACHE_MAX_BYTES || cache.size <= 1) break;
      cache.delete(id);
      total -= bytesOf(b);
    }
  }

  function load(id) {
    const hit = cache.get(id);
    if (hit) {
      // Re-insert so the oldest-used clip is the first to go.
      cache.delete(id);
      cache.set(id, hit);
      return Promise.resolve(hit);
    }
    if (inflight.has(id)) return inflight.get(id);
    const ctx = getContext();
    const job = (async () => {
      try {
        const res = await fetchFn(`${base}/${id}.mp3`);
        if (!res.ok) throw new Error(`cue clip HTTP ${res.status}`);
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        cache.set(id, decoded);
        evict();
        return decoded;
      } catch (err) {
        report(err, { source: 'cuePlayer', clip: id });
        throw err;
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, job);
    return job;
  }

  function playBuffer(ctx, buffer, when, node) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(node);
    src.start(when);
    return src;
  }

  function stopSources(list) {
    for (const src of list) {
      try {
        src.stop();
      } catch {
        // Already ended: stopping a finished source throws, and that is fine.
      }
    }
  }

  function free(mine) {
    if (slot !== mine) return;
    slot = null;
    drain();
  }

  function drain() {
    const next = pending;
    pending = null;
    if (next && nowMs() - next.queuedAt <= next.ttlMs) start(next);
  }

  async function start(cue) {
    const mine = { cue, sources: [] };
    slot = mine;
    const ctx = getContext();
    let buffers;
    try {
      const ids = cue.parts.map((p) => p.id);
      if (cue.tone) ids.push(cue.tone.id);
      buffers = await Promise.all(ids.map(load));
    } catch {
      // load() has already reported it; the cue is skipped.
      free(mine);
      return 'failed';
    }
    if (slot !== mine) return 'cancelled';
    if (cue.event !== 'finish' && nowMs() - cue.queuedAt > cue.ttlMs) {
      free(mine);
      return 'stale';
    }
    const g = gainsFor(ctx);
    const t0 = ctx.currentTime + START_AHEAD_S;
    const toneBuf = cue.tone ? buffers[buffers.length - 1] : null;
    const lead =
      toneBuf && !cue.tone.after
        ? toneBuf.duration + TONE_TO_VOICE_MS / 1000
        : 0;
    let end = t0;
    let last = null;
    if (toneBuf && !cue.tone.after) {
      const src = playBuffer(ctx, toneBuf, t0, g.tone);
      mine.sources.push(src);
      end = t0 + toneBuf.duration;
      last = src;
      lastToneAt = nowMs();
    }
    cue.parts.forEach((part, i) => {
      const buf = buffers[i];
      const at = t0 + lead + part.startMs / 1000;
      const src = playBuffer(ctx, buf, at, g.voice);
      mine.sources.push(src);
      if (at + buf.duration >= end) {
        end = at + buf.duration;
        last = src;
      }
    });
    if (toneBuf && cue.tone.after) {
      const at = end + END_STING_DELAY_MS / 1000;
      const src = playBuffer(ctx, toneBuf, at, g.tone);
      mine.sources.push(src);
      end = at + toneBuf.duration;
      last = src;
      lastToneAt = nowMs();
    }
    const done = () => free(mine);
    if (last) last.onended = done;
    // A suspended context never fires `ended`; this keeps the slot from
    // sticking shut.
    setTimeout(done, (end - ctx.currentTime) * 1000 + FREE_SLACK_MS);
    return 'started';
  }

  async function playTone(cue) {
    const ctx = getContext();
    if (!cue.tone || slot || nowMs() - lastToneAt < TONE_MIN_GAP_MS) {
      return 'dropped';
    }
    try {
      const buf = await load(cue.tone.id);
      const src = playBuffer(
        ctx,
        buf,
        ctx.currentTime + START_AHEAD_S,
        gainsFor(ctx).tone
      );
      toneSources.add(src);
      src.onended = () => toneSources.delete(src);
      lastToneAt = nowMs();
      return 'started';
    } catch {
      // load() has already reported it.
      return 'failed';
    }
  }

  // cue: { event, priority, ttlMs, parts: [{ id, startMs }], tone }, from
  // cueStitch. Resolves with what happened to it, for the test button and
  // the tests; nothing in a live session waits on it.
  async function play(input) {
    if (muted) return 'muted';
    if (!getContext()) return 'no-audio';
    const cue = { ...input, queuedAt: nowMs() };
    if (!cue.parts.length) return playTone(cue);
    if (slot) {
      if (cue.event === 'finish') {
        stopSources(slot.sources);
        slot = null;
        return start(cue);
      }
      if (cue.priority <= 2) {
        if (!pending || cue.priority <= pending.priority) pending = cue;
        return 'queued';
      }
      return 'dropped';
    }
    return start(cue);
  }

  function cancelAll() {
    pending = null;
    if (slot) stopSources(slot.sources);
    slot = null;
    stopSources(toneSources);
    toneSources.clear();
  }

  return {
    getIndex,
    play,
    cancelAll,
    warm(ids) {
      if (!getContext()) return;
      ids.reduce(
        (chain, id) => chain.then(() => load(id)).catch(() => {}),
        Promise.resolve()
      );
    },
    setMuted(value) {
      muted = !!value;
      if (muted) cancelAll();
      listeners.forEach((fn) => fn());
    },
    isMuted: () => muted,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      cancelAll();
      cache.clear();
      listeners.clear();
    },
  };
}
