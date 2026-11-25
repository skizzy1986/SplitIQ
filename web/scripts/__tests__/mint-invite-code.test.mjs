import { describe, expect, it } from 'vitest';
import {
  buildInsertSql,
  generateCode,
  hashCode,
  normaliseCode,
} from '../mint-invite-code.mjs';

// The same vector sits in supabase/functions/invite-signup/test.ts. If one side
// changes, the other must, or minted codes stop matching.
const VECTOR_HASH =
  'a87ea262d1284861323b30eef0d41fd08450bdc355ff0af898c188c81fe5427e';

describe('mint-invite-code', () => {
  it('normalises the way the edge function does', () => {
    expect(normaliseCode(' 7k3m-9qwx 2bdf-hj4r ')).toBe('7K3M9QWX2BDFHJ4R');
    expect(normaliseCode('0o1il-ab')).toBe('00111AB');
  });

  it('hashes to the shared vector, however it is typed', () => {
    expect(hashCode('7k3m-9qwx-2bdf-hj4r')).toBe(VECTOR_HASH);
    expect(hashCode('7K3M9QWX2BDFHJ4R')).toBe(VECTOR_HASH);
  });

  it('generates 16 characters in four groups, with no look-alike letters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/
      );
      expect(normaliseCode(code)).toBe(code.replace(/-/g, ''));
    }
  });

  it('is deterministic for fixed bytes and draws no two codes alike at random', () => {
    expect(generateCode(Buffer.alloc(32, 1))).toBe('1111-1111-1111-1111');
    const seen = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(seen.size).toBe(100);
  });

  it('skips biased bytes', () => {
    const bytes = Buffer.concat([Buffer.alloc(3, 255), Buffer.alloc(32, 0)]);
    expect(generateCode(bytes)).toBe('0000-0000-0000-0000');
  });

  it('fails loudly rather than return a short code', () => {
    expect(() => generateCode(Buffer.alloc(32, 255))).toThrow(/random bytes/);
  });

  it('builds SQL holding only the hash, never the code', () => {
    const sql = buildInsertSql({
      hash: VECTOR_HASH,
      uses: 1,
      days: 14,
      email: null,
      note: null,
    });
    expect(sql).toContain(VECTOR_HASH);
    expect(sql).toContain("interval '14 days'");
    expect(sql).not.toMatch(/7K3M/i);
  });

  it('lower-cases a bound email and escapes quotes', () => {
    const sql = buildInsertSql({
      hash: VECTOR_HASH,
      uses: 2,
      days: 7,
      email: ' Tester@Example.com ',
      note: "Paul's invite",
    });
    expect(sql).toContain("'tester@example.com'");
    expect(sql).toContain("'Paul''s invite'");
  });

  it('rejects out-of-range or malformed input', () => {
    const base = { hash: VECTOR_HASH, uses: 1, days: 14 };
    expect(() => buildInsertSql({ ...base, hash: 'abc' })).toThrow();
    expect(() => buildInsertSql({ ...base, uses: 0 })).toThrow();
    expect(() => buildInsertSql({ ...base, uses: 51 })).toThrow();
    expect(() => buildInsertSql({ ...base, days: 0 })).toThrow();
    expect(() => buildInsertSql({ ...base, days: 91 })).toThrow();
  });
});
