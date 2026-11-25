import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_BYTES,
  END_STING_DELAY_MS,
  TONE_MIN_GAP_MS,
  createCuePlayer,
} from '../cuePlayer.js';

// A fake AudioContext: buffers are { duration, length, numberOfChannels } and
// every source records when it was told to start.
function fakeAudio({ decodeFails = new Set(), seconds = 1 } = {}) {
  const sources = [];
  const ctx = {
    currentTime: 10,
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    createBufferSource: () => {
      const src = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn((when) => {
          src.when = when;
        }),
        stop: vi.fn(() => {
          src.stopped = true;
        }),
        onended: null,
      };
      sources.push(src);
      return src;
    },
    decodeAudioData: vi.fn(async (bytes) => {
      const tag = new globalThis.TextDecoder().decode(bytes);
      if (decodeFails.has(tag)) throw new Error('bad audio');
      return {
        tag,
        duration: seconds,
        length: 48000 * seconds,
        numberOfChannels: 1,
      };
    }),
  };
  return { ctx, sources };
}

function fakeFetch(missing = new Set()) {
  return vi.fn(async (url) => {
    const id = url.replace('/audio/cues/', '').replace('.mp3', '');
    if (missing.has(id)) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new globalThis.TextEncoder().encode(id).buffer,
      json: async () => ({ clips: {} }),
    };
  });
}

const cue = (event, priority, parts, extra = {}) => ({
  event,
  priority,
  ttlMs: 3000,
  parts: parts.map((id, i) => ({ id, startMs: i * 1500 })),
  tone: null,
  ...extra,
});

let clock;
let audio;
let report;
function make(options = {}) {
  audio = fakeAudio(options);
  report = vi.fn();
  return createCuePlayer({
    getContext: () => audio.ctx,
    fetchFn: options.fetchFn ?? fakeFetch(options.missing),
    nowMs: () => clock,
    report,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clock = 0;
});

describe('cuePlayer', () => {
  it('schedules a stitched cue up front on the audio clock', async () => {
    const p = make({ seconds: 1 });
    expect(await p.play(cue('go', 0, ['dry/a', 'dry/b']))).toBe('started');
    expect(audio.sources).toHaveLength(2);
    const [lead, line] = audio.sources;
    expect(line.when - lead.when).toBeCloseTo(1.5, 5);
    expect(lead.when).toBeGreaterThan(audio.ctx.currentTime);
  });

  it('plays a verdict tone before the line, and the end sting after it', async () => {
    const p = make({ seconds: 1 });
    await p.play(
      cue('rest', 0, ['dry/a'], {
        tone: { id: 'tones/hit', durationMs: 180, after: false },
      })
    );
    const [tone, voice] = audio.sources;
    expect(voice.when).toBeGreaterThan(tone.when);
    p.cancelAll();

    const q = make({ seconds: 1 });
    await q.play(
      cue('finish', 0, ['dry/f'], {
        tone: { id: 'tones/end_sting', durationMs: 400, after: true },
      })
    );
    const [line, sting] = audio.sources;
    expect(sting.when - (line.when + 1)).toBeCloseTo(
      END_STING_DELAY_MS / 1000,
      5
    );
  });

  it('never cuts a speaking cue; P0-P2 wait as one pending cue, P3 is dropped', async () => {
    const p = make();
    await p.play(cue('go', 0, ['dry/a']));
    expect(await p.play(cue('hit', 3, ['dry/h']))).toBe('dropped');
    expect(await p.play(cue('half', 2, ['dry/h2']))).toBe('queued');
    expect(await p.play(cue('rate', 2, ['dry/r']))).toBe('queued');
    expect(await p.play(cue('zone', 2, ['dry/z']))).toBe('queued');
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0].stopped).toBeUndefined();
    // The slot frees: the latest equal-priority cue runs, not the earlier ones.
    audio.sources[0].onended();
    await flush();
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[1].buffer.tag).toBe('dry/z');
  });

  it('keeps a higher-priority pending cue over a later lower one', async () => {
    const p = make();
    await p.play(cue('go', 0, ['dry/a']));
    await p.play(cue('last500', 1, ['dry/l']));
    await p.play(cue('rate', 2, ['dry/r']));
    audio.sources[0].onended();
    await flush();
    expect(audio.sources[1].buffer.tag).toBe('dry/l');
  });

  it('discards a pending cue that is stale when the slot frees', async () => {
    const p = make();
    await p.play(cue('go', 0, ['dry/a']));
    await p.play(cue('half', 2, ['dry/h'], { ttlMs: 4000 }));
    clock = 5000;
    audio.sources[0].onended();
    await flush();
    expect(audio.sources).toHaveLength(1);
  });

  it('lets finish cut anything', async () => {
    const p = make();
    await p.play(cue('go', 0, ['dry/a']));
    const first = audio.sources[0];
    expect(await p.play(cue('finish', 0, ['dry/f']))).toBe('started');
    expect(first.stopped).toBe(true);
    expect(audio.sources.at(-1).buffer.tag).toBe('dry/f');
  });

  it('drops a tone under speech, but plays one when quiet, at most every 400 ms', async () => {
    const p = make();
    const tone = (t) => ({
      event: t,
      priority: 3,
      ttlMs: 1000,
      parts: [],
      tone: { id: `tones/${t}`, durationMs: 100 },
    });
    await p.play(cue('go', 0, ['dry/a']));
    expect(await p.play(tone('hit'))).toBe('dropped');
    p.cancelAll();
    clock = 1000;
    expect(await p.play(tone('hit'))).toBe('started');
    clock = 1000 + TONE_MIN_GAP_MS - 1;
    expect(await p.play(tone('miss'))).toBe('dropped');
    clock = 1000 + TONE_MIN_GAP_MS;
    expect(await p.play(tone('miss'))).toBe('started');
  });

  it('cancelAll stops what is playing and forgets the pending cue', async () => {
    const p = make();
    await p.play(cue('go', 0, ['dry/a']));
    await p.play(cue('half', 2, ['dry/h']));
    p.cancelAll();
    expect(audio.sources[0].stopped).toBe(true);
    await flush();
    expect(audio.sources).toHaveLength(1);
    expect(await p.play(cue('go', 0, ['dry/b']))).toBe('started');
  });

  it('reports a fetch or decode failure and skips the cue without throwing', async () => {
    const p = make({ missing: new Set(['dry/gone']) });
    expect(await p.play(cue('go', 0, ['dry/gone']))).toBe('failed');
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      source: 'cuePlayer',
      clip: 'dry/gone',
    });
    // The slot is free again.
    expect(await p.play(cue('go', 0, ['dry/ok']))).toBe('started');

    const q = make({ decodeFails: new Set(['dry/bad']) });
    expect(await q.play(cue('go', 0, ['dry/bad']))).toBe('failed');
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an audio context, and when muted', async () => {
    const p = createCuePlayer({ getContext: () => null, fetchFn: fakeFetch() });
    expect(await p.play(cue('go', 0, ['dry/a']))).toBe('no-audio');
    const q = make();
    q.setMuted(true);
    expect(await q.play(cue('go', 0, ['dry/a']))).toBe('muted');
    expect(audio.sources).toHaveLength(0);
    q.setMuted(false);
    expect(await q.play(cue('go', 0, ['dry/a']))).toBe('started');
  });

  it('muting cuts what is playing and tells subscribers', async () => {
    const p = make();
    const seen = vi.fn();
    p.subscribe(seen);
    await p.play(cue('go', 0, ['dry/a']));
    p.setMuted(true);
    expect(audio.sources[0].stopped).toBe(true);
    expect(p.isMuted()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('decodes a clip once, and evicts the least recently used past the cap', async () => {
    // 1 s of mono float audio is 192 000 bytes; 40 s each is 7.68 MB.
    const p = make({ seconds: 40 });
    const total = Math.floor(CACHE_MAX_BYTES / (48000 * 40 * 4)) + 2;
    for (let i = 0; i < total; i++) {
      await p.play(cue('go', 0, [`dry/c${i}`]));
      audio.sources.at(-1).onended();
      await flush();
    }
    const decoded = audio.ctx.decodeAudioData.mock.calls.length;
    expect(decoded).toBe(total);
    // The newest is still cached; the oldest was evicted and decodes again.
    await p.play(cue('go', 0, [`dry/c${total - 1}`]));
    audio.sources.at(-1).onended();
    await flush();
    expect(audio.ctx.decodeAudioData).toHaveBeenCalledTimes(decoded);
    await p.play(cue('go', 0, ['dry/c0']));
    expect(audio.ctx.decodeAudioData).toHaveBeenCalledTimes(decoded + 1);
  });

  it('loads the index once and reports a failed load', async () => {
    const fetchFn = fakeFetch();
    const p = make({ fetchFn });
    await p.getIndex();
    await p.getIndex();
    expect(
      fetchFn.mock.calls.filter(([u]) => u.endsWith('cues.index.json'))
    ).toHaveLength(1);

    const failing = make({
      fetchFn: vi.fn(async () => ({ ok: false, status: 404 })),
    });
    expect(await failing.getIndex()).toBeNull();
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      source: 'cuePlayer',
      clip: 'cues.index.json',
    });
  });
});
