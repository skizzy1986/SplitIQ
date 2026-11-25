import {
  MIN_SPLIT_S,
  bandForInterval,
  classifyBand,
  currentInterval,
  planCount,
} from '../live-erg/intervalModel.js';

// Edge detection for the voice cues (#785). One live sample plus the v10 split
// tracker in, a new state and a list of cue intents out. No audio, no DOM, no
// React, no clock and no randomness: the caller passes `nowMs`, a wall clock
// (the PM5's own clock restarts every interval). cueStitch turns an intent
// into clips. Reuses the screen's band and its 2 W latch (classifyBand), so a
// cue never disagrees with the badge the athlete is looking at.
//
// Every number below is a named constant so Scott can tune after a real row.

// A split is a hit if its closed-split average is within this many watts of
// the band target (Scott, 25 Nov 2026). classifyBand's 2 W latch still applies.
export const HIT_TOLERANCE_W = 5;

export const GO_DEBOUNCE_MS = 3000;
export const TARGET_DELAY_MS = 8000;
export const SETTLE_MS = 10000;
export const ZONE_ENTER_DWELL_MS = 5000;
export const ZONE_LEAVE_DWELL_MS = 6000;
export const ZONE_ENTER_COOLDOWN_MS = 20000;
export const ZONE_LEAVE_COOLDOWN_MS = 30000;
export const ZONE_LEAVE_VOICED_MAX = 2;
export const RATE_DWELL_MS = 15000;
export const RATE_COOLDOWN_MS = 60000;
export const RATE_MAX_PER_INTERVAL = 3;
export const RATE_DEVIATION_SPM = 3;
export const REST_VOICE_MIN_S = 8;
export const MISS_VOICED_MAX = 2;
// 4 s of quiet after a cue plus about 3 s of speech, start to start.
export const VOICE_SPACING_MS = 7000;
export const BUDGET_WINDOW_MS = 60000;
export const HALF_MIN_M = 2000;
export const HALF_MIN_S = 360;
export const LAST500_M = 500;
export const LASTMIN_S = 60;
export const NEAR_END_M = 150;
export const NEAR_END_S = 30;
export const MISMATCH_M = 50;
export const MISMATCH_S = 10;

// Standard is the default (Scott, 25 Nov 2026): voice for intervals and
// verdicts, tones for 500 m splits, a hit voiced one time in three.
export const CHATTINESS = {
  quiet: { zone: false, rate: false, hitEvery: 0, splits500: false, budget: 3 },
  standard: {
    zone: true,
    rate: true,
    hitEvery: 3,
    splits500: false,
    budget: 6,
  },
  chatty: { zone: true, rate: true, hitEvery: 1, splits500: true, budget: 10 },
};

export function createCueState() {
  return {
    phase: 'ready',
    edges: 0,
    lastGoMs: -Infinity,
    segStartMs: 0,
    lastTarget: null,
    targetDone: false,
    halfDone: false,
    last500Done: false,
    lastminDone: false,
    seenSplits: 0,
    mismatch: false,
    zone: {
      dir: null,
      since: 0,
      fired: false,
      canEnter: true,
      lastEnterMs: -Infinity,
      lastLeaveMs: -Infinity,
      leavesVoiced: 0,
    },
    rate: { since: null, lastMs: -Infinity, count: 0 },
    hits: 0,
    missStreak: 0,
    voicedAt: [],
  };
}

function segmentOf(workout, tracker, sample) {
  if (!workout) return null;
  if (workout.type === 'int') {
    const iv = currentInterval(workout, tracker.intervalNo);
    if (!iv) return null;
    const done =
      iv.unit === 'm'
        ? sample.distance - tracker.base.d
        : sample.elapsedTime - tracker.base.t;
    return { unit: iv.unit, length: iv.work, done };
  }
  if (workout.type === 'dist') {
    return { unit: 'm', length: workout.total, done: sample.distance };
  }
  if (workout.type === 'time') {
    return { unit: 's', length: workout.total, done: sample.elapsedTime };
  }
  return null;
}

function remainingSeconds(seg, sample) {
  if (!seg) return null;
  const left = seg.length - seg.done;
  if (seg.unit === 's') return left;
  const pace = sample.pace500 > 0 ? sample.pace500 / 100 : null;
  return pace == null ? null : (left * pace) / 500;
}

function hitBandFor(workout, intervalNo) {
  const base = bandForInterval(workout, intervalNo);
  if (!base || base.target == null) return null;
  return {
    lo: base.target - HIT_TOLERANCE_W,
    hi: base.target + HIT_TOLERANCE_W,
    target: base.target,
  };
}

function verdictOf(row, workout, closedNo) {
  const band = hitBandFor(workout, closedNo);
  if (!band || !Number.isFinite(row?.w) || !(row.time >= MIN_SPLIT_S)) {
    return null;
  }
  return classifyBand(row.w, band);
}

// A P2 or P3 cue may speak only if it is far enough from the last one and the
// last minute is under budget; otherwise it falls back to its tone. P0 and P1
// are never gated.
function gate(s, intent, nowMs, chatter) {
  if (!intent.voiced) return intent;
  if (intent.priority <= 1) {
    s.voicedAt.push(nowMs);
    return intent;
  }
  s.voicedAt = s.voicedAt.filter((t) => nowMs - t < BUDGET_WINDOW_MS);
  const last = s.voicedAt[s.voicedAt.length - 1] ?? -Infinity;
  if (nowMs - last < VOICE_SPACING_MS || s.voicedAt.length >= chatter.budget) {
    return { ...intent, voiced: false };
  }
  s.voicedAt.push(nowMs);
  return intent;
}

function newSegment(s, nowMs) {
  s.segStartMs = nowMs;
  s.targetDone = false;
  s.halfDone = false;
  s.last500Done = false;
  s.lastminDone = false;
  s.zone = {
    ...s.zone,
    dir: null,
    fired: false,
    canEnter: true,
    leavesVoiced: 0,
  };
  s.rate = { ...s.rate, since: null, count: 0 };
}

function unexpectedRest(workout, tracker) {
  if (!workout) return false;
  if (workout.type !== 'int') return true;
  const closed = tracker.intervalNo - 1;
  const iv = closed >= 1 ? currentInterval(workout, closed) : null;
  return closed > planCount(workout) || !iv || !(iv.rest > 0);
}

const OFF_PLAN = {
  m: MISMATCH_M,
  s: MISMATCH_S,
};

// input: { sample, tracker, workout, nowMs, chatter } where chatter is a key
// of CHATTINESS. Returns { state, intents }.
export function detectCues(prev, input) {
  const { sample, tracker, workout, nowMs } = input;
  const chatter = CHATTINESS[input.chatter] ?? CHATTINESS.standard;
  const s = {
    ...prev,
    zone: { ...prev.zone },
    rate: { ...prev.rate },
    voicedAt: prev.voicedAt.slice(),
  };
  const intents = [];
  const phase = tracker.phase;
  const before = prev.phase;
  s.phase = phase;
  const newRows = tracker.splits.slice(prev.seenSplits);
  s.seenSplits = tracker.splits.length;
  const row = newRows.length ? newRows[newRows.length - 1] : null;
  const total = planCount(workout);
  const isInt = workout?.type === 'int';
  const seg = phase === 'work' ? segmentOf(workout, tracker, sample) : null;

  if (seg && seg.done > seg.length + OFF_PLAN[seg.unit]) s.mismatch = true;

  // E1 go: the edge into work, debounced against Just Row flicker.
  if (phase === 'work' && before !== 'work') {
    if (nowMs - prev.lastGoMs >= GO_DEBOUNCE_MS) {
      const firstEdge = prev.edges === 0;
      // cueStitch falls back to "interval n" for totals with no clip.
      const lead = isInt
        ? { kind: 'of_n', n: tracker.intervalNo, of: total }
        : null;
      let line = 'go';
      if (firstEdge) line = 'start';
      else if (isInt && tracker.intervalNo === total) line = 'last';
      intents.push({
        event: 'go',
        priority: 0,
        ttlMs: 1500,
        line,
        lead: firstEdge ? null : lead,
        firstEdge,
        voiced: true,
      });
      s.edges = prev.edges + 1;
      s.lastGoMs = nowMs;
      newSegment(s, nowMs);
    }
  }

  // E10 rest start, with the verdict tone of the interval that just closed.
  if (phase === 'rest' && before === 'work') {
    const closedNo = tracker.intervalNo - 1;
    if (unexpectedRest(workout, tracker)) s.mismatch = true;
    const verdict = row ? verdictOf(row, workout, closedNo) : null;
    const iv = isInt ? currentInterval(workout, closedNo) : null;
    const restS = iv?.rest ?? null;
    intents.push({
      event: 'rest',
      priority: 0,
      ttlMs: 3000,
      line: 'rest',
      lead: restS && !s.mismatch ? { kind: 'rest_t', value: restS } : null,
      restS: s.mismatch ? null : restS,
      voiced: restS == null || restS >= REST_VOICE_MIN_S,
      tone: verdict ? (verdict.dir === 'in' ? 'hit' : 'miss') : 'split_change',
    });
    if (verdict?.dir === 'in') {
      s.hits += 1;
      s.missStreak = 0;
    }
  }

  if (phase === 'work') {
    const sinceStart = nowMs - s.segStartMs;
    const paused = sample.rowingState === 0;
    const untilEnd = remainingSeconds(seg, sample);
    const settled =
      sinceStart >= SETTLE_MS && !(untilEnd != null && untilEnd <= 10);

    // E2 target announce, once per segment.
    if (!s.targetDone && sinceStart >= TARGET_DELAY_MS) {
      s.targetDone = true;
      const band = bandForInterval(workout, tracker.intervalNo);
      const target = band?.target ?? null;
      if (
        target != null &&
        (tracker.intervalNo === 1 || target !== s.lastTarget)
      ) {
        intents.push({
          event: 'target',
          priority: 2,
          ttlMs: 3000,
          line: 'split',
          lead: { kind: 'target_w', value: target },
          midPiece: true,
          voiced: true,
        });
      }
      s.lastTarget = target;
    }

    // Splits closed while still working: verdict, or the split number.
    if (row && before === 'work') {
      s.zone.leavesVoiced = 0;
      const verdict = verdictOf(
        row,
        workout,
        isInt ? tracker.splits.length : 1
      );
      if (verdict && verdict.dir !== 'none') {
        const hit = verdict.dir === 'in';
        let voiced;
        if (hit) {
          voiced = chatter.hitEvery > 0 && s.hits % chatter.hitEvery === 0;
          s.hits += 1;
          s.missStreak = 0;
        } else {
          voiced = s.missStreak < MISS_VOICED_MAX;
          s.missStreak = voiced ? s.missStreak + 1 : s.missStreak;
        }
        intents.push({
          event: hit ? 'hit' : 'miss',
          priority: 3,
          ttlMs: 6000,
          line: hit ? 'hit' : 'miss',
          dir: verdict.dir,
          midPiece: true,
          voiced,
          tone: hit ? 'hit' : 'miss',
        });
      } else if (!hitBandFor(workout, 1)) {
        intents.push({
          event: 'split',
          priority: 3,
          ttlMs: 3000,
          line: 'split',
          lead: { kind: 'split_n', value: tracker.splits.length + 1 },
          midPiece: true,
          voiced:
            !(workout.type === 'dist' && workout.split <= 500) ||
            chatter.splits500,
          tone: 'split_change',
        });
      }
      // E9 last split of a fixed piece.
      if (
        !isInt &&
        total > 1 &&
        tracker.splits.length === total - 1 &&
        !s.mismatch
      ) {
        intents.push({
          event: 'last',
          priority: 1,
          ttlMs: 4000,
          line: 'last',
          voiced: true,
          toneIfSilent: 'split_change',
        });
      }
    }

    // E6 half, E7 last 500 m, E8 last minute: once per segment.
    if (seg && !s.mismatch) {
      const left = seg.length - seg.done;
      const { unit, length } = seg;
      if (
        unit === 'm' &&
        length > 1000 &&
        left <= LAST500_M &&
        !s.last500Done
      ) {
        s.last500Done = true;
        intents.push({
          event: 'last500',
          priority: 1,
          ttlMs: 4000,
          line: 'last500',
          voiced: true,
          toneIfSilent: 'split_change',
        });
      }
      if (unit === 's' && length > 120 && left <= LASTMIN_S && !s.lastminDone) {
        s.lastminDone = true;
        intents.push({
          event: 'lastmin',
          priority: 1,
          ttlMs: 4000,
          line: 'lastmin',
          voiced: true,
          toneIfSilent: 'split_change',
        });
      }
      const longEnough =
        unit === 'm' ? length >= HALF_MIN_M : length >= HALF_MIN_S;
      if (longEnough && !s.halfDone && seg.done >= length / 2) {
        s.halfDone = true;
        const nearEnd =
          unit === 'm' ? LAST500_M + NEAR_END_M : LASTMIN_S + NEAR_END_S;
        if (left > nearEnd) {
          intents.push({
            event: 'half',
            priority: 2,
            ttlMs: 4000,
            line: 'half',
            voiced: true,
            toneIfSilent: 'split_change',
          });
        }
      }
    }

    // E4 zone enter and leave, from the same band the screen shows.
    const band = bandForInterval(workout, tracker.intervalNo);
    if (paused || !band || !Number.isFinite(sample.watts) || !settled) {
      s.zone.dir = null;
    } else {
      const v = classifyBand(sample.watts, band);
      const z = s.zone;
      if (v.dir !== z.dir) {
        z.dir = v.dir;
        z.since = nowMs;
        z.fired = false;
        if (v.dir === 'under' || v.dir === 'over') z.canEnter = true;
      }
      const dwell = nowMs - z.since;
      if (
        v.dir === 'in' &&
        !z.fired &&
        z.canEnter &&
        dwell >= ZONE_ENTER_DWELL_MS &&
        nowMs - z.lastEnterMs >= ZONE_ENTER_COOLDOWN_MS
      ) {
        z.fired = true;
        z.canEnter = false;
        z.lastEnterMs = nowMs;
        intents.push({
          event: 'zone_enter',
          priority: 2,
          ttlMs: 3000,
          line: 'in_band',
          midPiece: true,
          voiced: chatter.zone,
          tone: 'zone_enter',
        });
      } else if (
        // Still out of the band after the cooldown: say so again.
        (v.dir === 'over' || v.dir === 'under') &&
        dwell >= ZONE_LEAVE_DWELL_MS &&
        nowMs - z.lastLeaveMs >= ZONE_LEAVE_COOLDOWN_MS
      ) {
        z.lastLeaveMs = nowMs;
        const voiced = chatter.zone && z.leavesVoiced < ZONE_LEAVE_VOICED_MAX;
        if (voiced) z.leavesVoiced += 1;
        const high = v.dir === 'over';
        intents.push({
          event: high ? 'zone_high' : 'zone_low',
          priority: 3,
          ttlMs: 3000,
          line: high ? 'zone_high' : 'zone_low',
          lead: { kind: 'delta', value: v.x },
          dir: v.dir,
          midPiece: true,
          voiced,
          tone: high ? 'zone_leave_high' : 'zone_leave_low',
        });
      }
    }

    // E11 stroke rate off the interval's rate.
    const iv = isInt ? currentInterval(workout, tracker.intervalNo) : null;
    const spm = sample.strokeRate;
    if (!chatter.rate || paused || !settled || !iv?.rate || spm == null) {
      s.rate.since = null;
    } else if (Math.abs(spm - iv.rate) < RATE_DEVIATION_SPM) {
      s.rate.since = null;
    } else {
      if (s.rate.since == null) s.rate.since = nowMs;
      if (
        nowMs - s.rate.since >= RATE_DWELL_MS &&
        nowMs - s.rate.lastMs >= RATE_COOLDOWN_MS &&
        s.rate.count < RATE_MAX_PER_INTERVAL
      ) {
        s.rate.lastMs = nowMs;
        s.rate.count += 1;
        s.rate.since = null;
        intents.push({
          event: 'rate',
          priority: 2,
          ttlMs: 3000,
          line: 'rate',
          lead: { kind: 'rate_n', value: spm },
          midPiece: true,
          voiced: true,
        });
      }
    }
  }

  intents.sort((a, b) => a.priority - b.priority);
  return {
    state: s,
    intents: intents.map((intent) => gate(s, intent, nowMs, chatter)),
  };
}
