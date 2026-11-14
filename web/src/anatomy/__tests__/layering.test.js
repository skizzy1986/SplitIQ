import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// The anatomy runtime is movement-neutral (R12, #440): a movement hands it its
// data; it never reaches for one. ESLint enforces this per import; this test
// resolves every relative import in the runtime's non-test code and checks
// where it actually lands, so a path the lint patterns miss is still caught.
const SRC = join(process.cwd(), 'src');
const ANATOMY = join(SRC, 'anatomy');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.(js|jsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

const forbidden = (target) => {
  const rel = relative(SRC, target).split(sep).join('/');
  return (
    rel.startsWith('squat/') ||
    rel.startsWith('movements/') ||
    /^utils\/squatRoute(\.|$)/.test(rel)
  );
};

describe('src/anatomy layering', () => {
  const files = sourceFiles(ANATOMY);

  it('finds the runtime it is guarding', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never imports squat/, movements/ or utils/squatRoute', () => {
    const bad = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const [, spec] of src.matchAll(SPECIFIER)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        if (forbidden(target)) bad.push(`${relative(SRC, file)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('would flag each forbidden destination', () => {
    expect(forbidden(join(SRC, 'squat/constants/barbell.js'))).toBe(true);
    expect(forbidden(join(SRC, 'movements/squat/movement.js'))).toBe(true);
    expect(forbidden(join(SRC, 'utils/squatRoute.js'))).toBe(true);
    expect(forbidden(join(SRC, 'utils/squatTheme.js'))).toBe(false);
    expect(forbidden(join(SRC, 'constants/themeValues.js'))).toBe(false);
  });
});
