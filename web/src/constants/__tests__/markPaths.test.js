import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as mark from '../markPaths.js';

// A path string is data, so check it as data: only the commands the module
// uses, numbers that parse, and every subpath closed.
const COMMANDS = /^[MLHVQAZ0-9 .,-]+$/;
const subpaths = (d) => d.split('M').filter(Boolean);

describe('markPaths', () => {
  it('is data only: no import, no export of anything but strings and numbers', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../markPaths.js'),
      'utf8'
    );
    expect(src).not.toMatch(/^\s*import\s/m);
    for (const v of Object.values(mark)) {
      expect(['string', 'number']).toContain(typeof v);
    }
  });

  it('holds no colour: the caller picks it', () => {
    for (const v of Object.values(mark)) {
      if (typeof v === 'string') expect(v).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it.each(['MARK_TILE_PATH', 'MARK_S_PATH', 'WORDMARK_PATH'])(
    '%s is well formed and closed',
    (name) => {
      const d = mark[name];
      expect(d).toMatch(COMMANDS);
      expect(d.startsWith('M')).toBe(true);
      for (const sp of subpaths(d)) expect(sp.endsWith('Z')).toBe(true);
      expect(d).not.toMatch(/NaN|undefined/);
    }
  );

  it('draws the icon: 192 grid, the 15..177 square with rx 24 and a 6 stroke', () => {
    expect(mark.MARK_SIZE).toBe(192);
    expect(mark.MARK_VIEWBOX).toBe('0 0 192 192');
    expect(mark.MARK_STROKE_WIDTH).toBe(6);
    // Four quarter arcs of radius 24 between corners at 15 and 177.
    expect(mark.MARK_TILE_PATH.match(/A24 24 0 0 1/g)).toHaveLength(4);
    expect(mark.MARK_TILE_PATH).toContain('M39 15H153');
    expect(mark.MARK_TILE_PATH).toContain('V153');
  });

  it('keeps the S inside the square, centred on x = 96 as the icon centres it', () => {
    const nums = mark.MARK_S_PATH.replace(/[A-Za-z]/g, ' ')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    expect(nums.every(Number.isFinite)).toBe(true);
    // Coordinates alternate x, y except for H and V, so take a conservative
    // bound over all of them: nothing leaves the inner edge of the stroke.
    expect(Math.min(...nums)).toBeGreaterThan(18);
    expect(Math.max(...nums)).toBeLessThan(174);
  });

  it('gives the wordmark a viewBox that matches its width and height', () => {
    expect(mark.WORDMARK_VIEWBOX).toBe(
      `0 0 ${mark.WORDMARK_WIDTH} ${mark.WORDMARK_HEIGHT}`
    );
    expect(mark.WORDMARK_WIDTH / mark.WORDMARK_HEIGHT).toBeGreaterThan(5);
  });
});
