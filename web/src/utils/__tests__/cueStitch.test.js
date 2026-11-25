import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GAP_MS,
  createRotation,
  resolveIntent,
  snapDelta,
  snapRest,
  snapTarget,
  warmStems,
} from '../cueStitch.js';

const here = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(
  readFileSync(
    resolve(here, '../../../public/audio/cues/cues.index.json'),
    'utf8'
  )
);

const rotation = () => createRotation(7);
const base = { event: 'x', priority: 2, ttlMs: 3000, voiced: true };
const resolveFor = (voice, intent, rot = rotation()) =>
  resolveIntent({ ...base, ...intent }, { voice, index, rotation: rot });
const ids = (cue) => cue.parts.map((p) => p.id);

describe('cueStitch snapping', () => {
  it('snaps a delta to the nearest recorded step, ties down, none outside 4 to 55', () => {
    expect(snapDelta(12)).toBe(10);
    expect(snapDelta(13)).toBe(15);
    expect(snapDelta(35)).toBe(30);
    expect(snapDelta(3)).toBeNull();
    expect(snapDelta(56)).toBeNull();
    expect(snapDelta(55)).toBe(50);
  });

  it('snaps a target to 10 W inside 60 to 400, a rest to a recorded length', () => {
    expect(snapTarget(245)).toBe(250);
    expect(snapTarget(244)).toBe(240);
    expect(snapTarget(406)).toBeNull();
    expect(snapTarget(54)).toBeNull();
    expect(snapRest(100)).toBe(90);
    expect(snapRest(105)).toBe(90);
    expect(snapRest(106)).toBe(120);
    expect(snapRest(301)).toBeNull();
  });
});

describe('cueStitch resolveIntent', () => {
  it('stitches a lead and a line with the 220 ms perceived gap', () => {
    const cue = resolveFor('dry', {
      line: 'split',
      lead: { kind: 'split_n', value: 9 },
    });
    expect(cue.parts).toHaveLength(2);
    expect(cue.parts[0]).toEqual({ id: 'dry/split_n-9', startMs: 0 });
    const lead = index.clips.dry['split_n-9'];
    const line = index.clips.dry[cue.parts[1].id.split('/')[1]];
    const gap = Math.max(0, GAP_MS - lead[2] - line[1]);
    expect(cue.parts[1].startMs).toBe(lead[0] + gap);
  });

  it('closes the gap to zero when the pads already exceed it', () => {
    const fake = {
      v: 1,
      gap_ms: 220,
      clips: {
        dry: { 'split_n-1': [1000, 60, 171], 'split-1': [1500, 60, 60] },
        tones: {},
      },
    };
    const cue = resolveIntent(
      { ...base, line: 'split', lead: { kind: 'split_n', value: 1 } },
      { voice: 'dry', index: fake, rotation: rotation() }
    );
    expect(cue.parts[1].startMs).toBe(1000 + Math.max(0, 220 - 171 - 60));
    const wide = JSON.parse(JSON.stringify(fake));
    wide.clips.dry['split_n-1'][2] = 400;
    expect(
      resolveIntent(
        { ...base, line: 'split', lead: { kind: 'split_n', value: 1 } },
        { voice: 'dry', index: wide, rotation: rotation() }
      ).parts[1].startMs
    ).toBe(1000);
  });

  it('skips a lead with no clip: split 51 is a line alone', () => {
    const cue = resolveFor('dry', {
      line: 'split',
      lead: { kind: 'split_n', value: 51 },
    });
    expect(cue.parts).toHaveLength(1);
    expect(cue.parts[0].id).toMatch(/^dry\/split-\d$/);
  });

  it('falls back to "interval n" when the "n of N" total was not recorded', () => {
    const six = resolveFor('dry', {
      line: 'go',
      lead: { kind: 'of_n', n: 2, of: 6 },
    });
    expect(six.parts[0].id).toBe('dry/rep_n-2');
    const four = resolveFor('dry', {
      line: 'go',
      lead: { kind: 'of_n', n: 2, of: 4 },
    });
    expect(four.parts[0].id).toBe('dry/of_n-2of4');
    const techSix = resolveFor('tech', {
      line: 'go',
      lead: { kind: 'of_n', n: 2, of: 6 },
    });
    expect(techSix.parts[0].id).toBe('tech/of_n-2of6');
  });

  it('picks a line of 3 s or less when a lead is present', () => {
    for (let seed = 1; seed < 30; seed++) {
      const cue = resolveFor(
        'dry',
        { line: 'split', lead: { kind: 'split_n', value: 3 }, midPiece: true },
        createRotation(seed)
      );
      const stem = cue.parts[1].id.split('/')[1];
      expect(index.clips.dry[stem][0]).toBeLessThanOrEqual(3000);
    }
  });

  it('never plays a long clip mid-piece when a short one exists', () => {
    for (let seed = 1; seed < 40; seed++) {
      const cue = resolveFor(
        'dry',
        { line: 'half', midPiece: true },
        createRotation(seed)
      );
      const stem = cue.parts[0].id.split('/')[1];
      expect(index.clips.dry[stem][3] ?? '').not.toContain('long');
    }
  });

  it('honours the flags: skip_v1, after_rest, under_only, needs_rest_s', () => {
    const drawn = (intent, voice = 'dry') => {
      const seen = new Set();
      const rot = rotation();
      for (let i = 0; i < 40; i++) {
        seen.add(resolveFor(voice, intent, rot).parts.at(-1).id.split('/')[1]);
      }
      return seen;
    };
    expect(drawn({ line: 'last' })).not.toContain('last-1');
    expect(drawn({ line: 'go', firstEdge: true })).not.toContain('go-1');
    expect(drawn({ line: 'go', firstEdge: false }).has('go-1')).toBe(true);
    expect(drawn({ line: 'miss', dir: 'over' })).not.toContain('miss-3');
    expect(drawn({ line: 'miss', dir: 'under' }).has('miss-3')).toBe(true);
    expect(drawn({ line: 'rest', restS: 90 })).not.toContain('rest-1');
    expect(drawn({ line: 'rest', restS: 120 }).has('rest-1')).toBe(true);
  });

  it('never repeats a clip back to back when a kind has two or more', () => {
    const rot = rotation();
    let last = null;
    for (let i = 0; i < 60; i++) {
      const id = resolveFor('dry', { line: 'miss', dir: 'under' }, rot).parts[0]
        .id;
      expect(id).not.toBe(last);
      last = id;
    }
  });

  it('plays the over and under lines with a delta lead, the solo line without', () => {
    const lead = resolveFor('dry', {
      line: 'zone_low',
      dir: 'under',
      lead: { kind: 'delta', value: 12 },
    });
    expect(lead.parts[0].id).toBe('dry/delta-10_under');
    expect(lead.parts[1].id).toMatch(/^dry\/under-\d$/);
    const solo = resolveFor('dry', {
      line: 'zone_high',
      dir: 'over',
      lead: { kind: 'delta', value: 3 },
    });
    expect(solo.parts).toHaveLength(1);
    expect(solo.parts[0].id).toMatch(/^dry\/over_solo-\d$/);
  });

  it('maps Technical onto its own lines, and has no delta lead', () => {
    expect(resolveFor('tech', { line: 'start' }).parts[0].id).toBe(
      'tech/work-1'
    );
    expect(resolveFor('tech', { line: 'hit' }).parts[0].id).toMatch(
      /^tech\/on_target-/
    );
    const low = resolveFor('tech', {
      line: 'zone_low',
      dir: 'under',
      lead: { kind: 'delta', value: 12 },
    });
    expect(low.parts).toHaveLength(1);
    expect(low.parts[0].id).toMatch(/^tech\/under-/);
    expect(
      resolveFor('tech', { line: 'miss', dir: 'over' }).parts[0].id
    ).toMatch(/^tech\/over-/);
  });

  it('gives Technical a tone alone where it has no clip, never another voice', () => {
    const cue = resolveFor('tech', {
      line: 'half',
      toneIfSilent: 'split_change',
    });
    expect(cue.parts).toEqual([]);
    expect(cue.tone.id).toBe('tones/split_change');
    expect(resolveFor('tech', { line: 'half' })).toBeNull();
    expect(
      resolveFor('tech', { line: 'rate', lead: { kind: 'rate_n', value: 28 } })
        .parts
    ).toEqual([{ id: 'tech/rate_n-28', startMs: 0 }]);
  });

  it('falls back to the tone when a cue is not allowed to speak', () => {
    const cue = resolveFor('dry', { line: 'hit', voiced: false, tone: 'hit' });
    expect(cue.parts).toEqual([]);
    expect(cue.tone.id).toBe('tones/hit');
    expect(resolveFor('dry', { line: 'hit', voiced: false })).toBeNull();
  });

  it('puts the end sting after the finish line and a verdict tone before', () => {
    const fin = resolveFor('dry', {
      line: 'finish',
      tone: 'end_sting',
      toneAfter: true,
    });
    expect(fin.tone.after).toBe(true);
    const rest = resolveFor('dry', {
      line: 'rest',
      lead: { kind: 'rest_t', value: 120 },
      tone: 'hit',
      restS: 120,
    });
    expect(rest.tone.after).toBe(false);
    expect(ids(rest)[0]).toBe('dry/rest_t-120');
  });

  it('only ever resolves ids that exist in the index, for every voice', () => {
    const lines = [
      'start',
      'go',
      'last',
      'hit',
      'miss',
      'in_band',
      'rest',
      'half',
      'last500',
      'lastmin',
      'split',
      'rate',
      'finish',
      'session_start',
      'session_end',
      'onboard',
      'zone_high',
      'zone_low',
    ];
    const leads = [
      null,
      { kind: 'split_n', value: 4 },
      { kind: 'of_n', n: 2, of: 5 },
      { kind: 'target_w', value: 237 },
      { kind: 'delta', value: 22 },
      { kind: 'rate_n', value: 26 },
      { kind: 'rest_t', value: 100 },
    ];
    for (const voice of ['dry', 'enc', 'tech']) {
      const rot = rotation();
      for (const line of lines) {
        for (const lead of leads) {
          for (const dir of ['under', 'over']) {
            const cue = resolveFor(
              voice,
              { line, lead, dir, restS: 120, tone: 'hit' },
              rot
            );
            for (const p of cue?.parts ?? []) {
              const [folder, stem] = p.id.split('/');
              expect(index.clips[folder][stem], p.id).toBeDefined();
            }
          }
        }
      }
    }
  });
});

describe('cueStitch warmStems', () => {
  it('lists the tones and the first cues, capped, all in the index', () => {
    const stems = warmStems({ voice: 'dry', index, targetW: 237 });
    expect(stems.length).toBeLessThanOrEqual(48);
    expect(stems).toContain('tones/hit');
    expect(stems).toContain('dry/target_w-240');
    for (const id of stems) {
      const [folder, stem] = id.split('/');
      expect(index.clips[folder][stem], id).toBeDefined();
    }
    expect(warmStems({ voice: 'nope', index })).toEqual([]);
  });
});

describe('cue index', () => {
  const sums = readFileSync(
    resolve(here, '../../../scripts/voice-cues.sha256'),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((l) => l.slice(66));

  it('matches the checksum list file for file, with no tip clips', () => {
    const fromIndex = [];
    for (const [folder, clips] of Object.entries(index.clips)) {
      for (const stem of Object.keys(clips))
        fromIndex.push(`${folder}/${stem}.mp3`);
    }
    expect(fromIndex.sort()).toEqual(sums.slice().sort());
    expect(sums.filter((p) => /\/tip-/.test(p))).toEqual([]);
  });
});
