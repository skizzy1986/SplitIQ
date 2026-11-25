// Turns a cue intent (what happened, from cueTriggers) into the clips to play
// (#785): a snapped number lead, the 220 ms gap, a rotated line. Pure: the
// clip index and a seeded rotation come in, a cue goes out. Never splices
// inside a sentence; a lead is a whole short sentence carrying one number.
//
// Index shape (public/audio/cues/cues.index.json, one entry per clip):
//   clips[folder][stem] = [duration_ms, head_ms, tail_ms, flags?]
// Folders are dry, enc, tech and tones. Tones carry only [duration_ms].

export const GAP_MS = 220;
export const LEAD_LINE_MAX_MS = 3000;

const DELTAS = [5, 10, 15, 20, 25, 30, 40, 50];
const RESTS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

// Technical has no clip for these, so its cue is the tone alone.
const LINES = {
  std: {
    start: 'start',
    go: 'go',
    last: 'last',
    hit: 'hit',
    miss: 'miss',
    in_band: 'in_band',
    rest: 'rest',
    half: 'half',
    last500: 'last500',
    lastmin: 'lastmin',
    split: 'split',
    rate: 'rate',
    finish: 'finish',
    session_start: 'session_start',
    session_end: 'session_end',
    onboard: 'onboard',
  },
  tech: {
    start: 'work',
    go: 'work_return',
    last: 'work_return',
    hit: 'on_target',
    in_band: 'on_target',
    rest: 'rest',
    split: 'split',
    finish: 'piece_end',
    session_start: 'session_start',
    session_end: 'session_end',
    onboard: 'onboard',
  },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A shuffled bag per (voice, kind): every variant plays once before any
// repeats, and a refill never opens with the clip that just played.
export function createRotation(seed = 1) {
  const rand = mulberry32(seed);
  const bags = new Map();
  return {
    pick(key, stems) {
      if (stems.length <= 1) return stems[0] ?? null;
      let slot = bags.get(key);
      if (!slot) {
        slot = { bag: [], last: null };
        bags.set(key, slot);
      }
      slot.bag = slot.bag.filter((s) => stems.includes(s));
      if (!slot.bag.length) {
        const next = stems.slice();
        for (let i = next.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [next[i], next[j]] = [next[j], next[i]];
        }
        if (next[0] === slot.last) [next[0], next[1]] = [next[1], next[0]];
        slot.bag = next;
      }
      slot.last = slot.bag.shift();
      return slot.last;
    },
  };
}

// Nearest member; a tie goes to the lower one so a number is never overstated.
export function snapTo(value, set) {
  let best = set[0];
  for (const v of set) {
    if (Math.abs(v - value) < Math.abs(best - value)) best = v;
  }
  return best;
}

export function snapDelta(x) {
  if (!(x >= 4) || x > 55) return null;
  return snapTo(x, DELTAS);
}

export function snapRest(seconds) {
  if (!(seconds > 0) || seconds > 300) return null;
  return snapTo(seconds, RESTS);
}

export function snapTarget(watts) {
  const w = Math.round(watts / 10) * 10;
  return w >= 60 && w <= 400 ? w : null;
}

function inRange(n, lo, hi) {
  const r = Math.round(n);
  return r >= lo && r <= hi ? r : null;
}

function leadStem(lead, dir, clips) {
  if (!lead) return null;
  let stem = null;
  if (lead.kind === 'split_n') {
    const n = inRange(lead.value, 1, 50);
    stem = n && `split_n-${n}`;
  } else if (lead.kind === 'rep_n') {
    const n = inRange(lead.value, 1, 40);
    stem = n && `rep_n-${n}`;
  } else if (lead.kind === 'of_n') {
    stem = `of_n-${lead.n}of${lead.of}`;
    // Only the totals that were recorded exist; otherwise "interval n".
    if (!clips[stem]) {
      const n = inRange(lead.n, 1, 40);
      stem = n && `rep_n-${n}`;
    }
  } else if (lead.kind === 'target_w') {
    const w = snapTarget(lead.value);
    stem = w && `target_w-${w}`;
  } else if (lead.kind === 'delta') {
    const d = snapDelta(lead.value);
    stem = d && `delta-${d}_${dir}`;
  } else if (lead.kind === 'rate_n') {
    const n = inRange(lead.value, 18, 36);
    stem = n && `rate_n-${n}`;
  } else if (lead.kind === 'rest_t') {
    const s = snapRest(lead.value);
    stem = s && `rest_t-${s}`;
  }
  return stem && clips[stem] ? stem : null;
}

function flagsOf(entry) {
  return entry[3] ? entry[3].split(',') : [];
}

function eligible(entry, intent) {
  for (const flag of flagsOf(entry)) {
    if (flag === 'skip_v1' || flag === 'phase2') return false;
    if (flag === 'after_rest' && intent.firstEdge) return false;
    if (flag === 'under_only' && intent.dir !== 'under') return false;
    if (flag.startsWith('needs_rest_s=')) {
      if (Number(flag.slice(13)) !== intent.restS) return false;
    }
  }
  return true;
}

function variantsOf(clips, kind) {
  const prefix = `${kind}-`;
  return Object.keys(clips).filter(
    (s) => s.startsWith(prefix) && !s.slice(prefix.length).includes('-')
  );
}

function lineKindFor(intent, voice, hasLead) {
  const table = voice === 'tech' ? LINES.tech : LINES.std;
  const zone = intent.line === 'zone_high' || intent.line === 'zone_low';
  if (zone) {
    const word = intent.line === 'zone_high' ? 'over' : 'under';
    if (voice === 'tech') return word;
    return hasLead ? word : `${word}_solo`;
  }
  if (intent.line === 'miss' && voice === 'tech') {
    return intent.dir === 'over' ? 'over' : 'under';
  }
  return table[intent.line] ?? null;
}

function pickLine(kind, intent, clips, voiceKey, rotation, hasLead) {
  let stems = variantsOf(clips, kind).filter((s) => eligible(clips[s], intent));
  if (!stems.length) return null;
  if (intent.midPiece) {
    const short = stems.filter((s) => !flagsOf(clips[s]).includes('long'));
    if (short.length) stems = short;
  }
  if (hasLead) {
    const fits = stems.filter((s) => clips[s][0] <= LEAD_LINE_MAX_MS);
    if (fits.length) stems = fits;
    else {
      const shortest = stems.reduce((a, b) =>
        clips[b][0] < clips[a][0] ? b : a
      );
      stems = [shortest];
    }
  }
  return rotation.pick(`${voiceKey}/${kind}`, stems);
}

// intent: { event, priority, ttlMs, line, lead?, dir?, voiced, tone?,
//   toneAfter?, firstEdge?, restS?, midPiece? }
// voice: 'dry' | 'enc' | 'tech'. Returns a cue for cuePlayer, or null when
// there is nothing to play (not even a tone).
export function resolveIntent(intent, { voice, index, rotation }) {
  const clips = index?.clips?.[voice];
  if (!clips) return null;
  const gap = index.gap_ms ?? GAP_MS;
  const toneOf = (name) => {
    const entry = name ? index.clips.tones?.[name] : null;
    return entry
      ? {
          id: `tones/${name}`,
          durationMs: entry[0],
          after: !!intent.toneAfter,
        }
      : null;
  };
  // `tone` plays with the voice; `toneIfSilent` only when no voice clip
  // exists for this cue (a Technical cue with no line, or a muted-by-limit one).
  const silentTone = toneOf(intent.tone ?? intent.toneIfSilent);
  const cue = {
    event: intent.event,
    priority: intent.priority,
    ttlMs: intent.ttlMs,
    parts: [],
    tone: silentTone,
  };
  if (!intent.voiced) return silentTone ? cue : null;

  let lead =
    voice === 'tech' && intent.lead?.kind === 'delta' ? null : intent.lead;
  const lStem = leadStem(lead, intent.dir, clips);
  const kind = lineKindFor(intent, voice, !!lStem);
  const line = kind
    ? pickLine(kind, intent, clips, voice, rotation, !!lStem)
    : null;
  if (!lStem && !line) return silentTone ? cue : null;

  let startMs = 0;
  if (lStem) {
    cue.parts.push({ id: `${voice}/${lStem}`, startMs: 0 });
    startMs = clips[lStem][0];
  }
  if (line) {
    const gapMs = lStem
      ? Math.max(0, gap - clips[lStem][2] - clips[line][1])
      : 0;
    cue.parts.push({ id: `${voice}/${line}`, startMs: startMs + gapMs });
  }
  cue.tone = toneOf(intent.tone);
  return cue;
}

// Clips worth decoding before a piece starts, so the first cues do not wait
// on a fetch. The player's cache is capped, so this stays short.
export function warmStems({ voice, index, targetW }) {
  const clips = index?.clips?.[voice];
  if (!clips) return [];
  const table = voice === 'tech' ? LINES.tech : LINES.std;
  const out = Object.keys(index.clips.tones ?? {}).map((t) => `tones/${t}`);
  const kinds = ['start', 'go', 'rest', 'hit', 'miss', 'in_band', 'finish'];
  for (const k of kinds) {
    const kind = table[k];
    if (!kind) continue;
    for (const s of variantsOf(clips, kind)) {
      if (eligible(clips[s], { firstEdge: false, dir: 'under' }))
        out.push(`${voice}/${s}`);
    }
  }
  const w = targetW == null ? null : snapTarget(targetW);
  if (w && clips[`target_w-${w}`]) out.push(`${voice}/target_w-${w}`);
  return out.slice(0, 48);
}
