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

const relativeToSrc = (target) => relative(SRC, target).split(sep).join('/');

const forbidden = (target) => {
  const rel = relativeToSrc(target);
  return (
    rel.startsWith('squat/') ||
    rel.startsWith('row/') ||
    rel.startsWith('tool/') ||
    rel.startsWith('movements/') ||
    /^utils\/movementRoute(\.|$)/.test(rel)
  );
};

// Every relative import in `files` that resolves somewhere `isBad` refuses.
function badImports(files, isBad) {
  const bad = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(SPECIFIER)) {
      if (!spec.startsWith('.')) continue;
      if (isBad(resolve(dirname(file), spec))) {
        bad.push(`${relative(SRC, file)} → ${spec}`);
      }
    }
  }
  return bad;
}

describe('src/anatomy layering', () => {
  const files = sourceFiles(ANATOMY);

  it('finds the runtime it is guarding', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never imports squat/, row/, tool/, movements/ or utils/movementRoute', () => {
    expect(badImports(files, forbidden)).toEqual([]);
  });

  it('would flag each forbidden destination', () => {
    expect(forbidden(join(SRC, 'squat/constants/barbell.js'))).toBe(true);
    expect(forbidden(join(SRC, 'row/RowApp.jsx'))).toBe(true);
    expect(forbidden(join(SRC, 'tool/ToolShell.jsx'))).toBe(true);
    expect(forbidden(join(SRC, 'movements/squat/movement.js'))).toBe(true);
    expect(forbidden(join(SRC, 'utils/movementRoute.js'))).toBe(true);
    expect(forbidden(join(SRC, 'utils/squatTheme.js'))).toBe(false);
    expect(forbidden(join(SRC, 'rowing/x.js'))).toBe(false);
    expect(forbidden(join(SRC, 'constants/themeValues.js'))).toBe(false);
  });
});

// One tool never reaches into another's folder: shared code belongs in
// anatomy/ (or, from #758, tool/), where both can import it.
describe('src/row layering', () => {
  const files = sourceFiles(join(SRC, 'row'));
  const intoSquat = (target) => relativeToSrc(target).startsWith('squat/');

  it('finds the tool it is guarding', () => {
    expect(files.map((f) => relativeToSrc(f))).toContain('row/RowApp.jsx');
  });

  it('src/row never imports squat/', () => {
    expect(badImports(files, intoSquat)).toEqual([]);
  });

  it('would flag an import of squat/', () => {
    expect(intoSquat(join(SRC, 'squat/hooks/useSquatTheme.js'))).toBe(true);
    expect(intoSquat(join(SRC, 'hooks/useTheme.js'))).toBe(false);
  });
});
