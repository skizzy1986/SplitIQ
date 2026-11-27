// @vitest-environment node
//
// #819 slice S2, Gate 2 brief §6 "CP scan" and §6a rows 1 and 3. The app must
// not show "CP" or "critical power" to an account that has no rowing CP.
// This reads every source file under web/src, parses it, and collects the
// string literals, template text and JSX text that name a CP. Every file with
// a hit must be on the allow-list below, and each entry names the component
// test that proves the words are hidden when there is no CP. A new hit in a new
// file fails here until someone adds the file, and its proof.
//
// Not scanned: tests, the message catalogs, the squat, anatomy and row tools
// (they have no CP of the user's), and the live erg screens, which belong to
// the live-erg lane (slice S2b, H 4) and are never touched by this package.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const espree = require('espree');

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../..');
const srcDir = resolve(webDir, 'src');

const SKIPPED_DIRS = new Set([
  '__tests__',
  'locales',
  'squat',
  'anatomy',
  'row',
  'movements',
  'live-erg',
  'test',
]);
// The legacy PM5 logger: off limits to this package (decision 10 (c)).
const SKIPPED_FILES = new Set(['views/ErgLiveView.jsx']);

// "CP" in capitals only (ids like 'rowing-cp' are not words on screen).
const isCpWord = (s) => /\bCP\b/.test(s) || /critical power/i.test(s);

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) yield* sourceFiles(full);
    } else if (/\.(js|jsx)$/.test(name)) {
      const rel = relative(srcDir, full).split('\\').join('/');
      if (!SKIPPED_FILES.has(rel)) yield rel;
    }
  }
}

// Every string-ish node's text, from a parsed file. Comments are not nodes.
function texts(source) {
  const ast = espree.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  });
  const found = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      found.push(node.value);
    } else if (node.type === 'TemplateElement') {
      found.push(node.value.cooked ?? node.value.raw);
    } else if (node.type === 'JSXText') {
      found.push(node.value);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  };
  walk(ast);
  return found;
}

// File -> the test that proves its CP words are hidden without a CP, and the
// name of the test inside it. Each file is a place a CP can be named; when
// there is no CP the screen shows something else.
const GATED = {
  'views/OverviewView.jsx': [
    'views/__tests__/OverviewView.test.jsx',
    'H1: no CP label or CP-derived watts without a rowing_cp anchor',
  ],
  'views/ErgView.jsx': [
    'views/__tests__/ErgView.test.jsx',
    "H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP",
  ],
  'constants/trainingConfig.js': [
    // FTP_TEST's words reach the screen only inside ErgView's CP-gated card.
    'views/__tests__/ErgView.test.jsx',
    "H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP",
  ],
  'components/session/ZoneBar.jsx': [
    'components/session/__tests__/ZoneBar.test.jsx',
    "H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP",
  ],
  'components/session/SessionSummary.jsx': [
    'components/session/__tests__/SessionSummary.test.jsx',
    "H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP",
  ],
  'components/session/ProvenanceNote.jsx': [
    'components/session/__tests__/ProvenanceNote.test.jsx',
    "H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP",
  ],
  'constants/cpFormCopy.js': [
    // Mounted nowhere until S4's expert-depth form; the guide and welcome card
    // tests prove neither shows a CP field.
    'components/__tests__/FirstRunGuide.test.jsx',
    'H2: page 3 describes the base block and asks for no CP',
  ],
};

const hits = new Map();
for (const rel of sourceFiles(srcDir)) {
  const found = texts(readFileSync(resolve(srcDir, rel), 'utf8')).filter(
    isCpWord
  );
  if (found.length > 0) hits.set(rel, found);
}

describe('CP strings (#819 H 1, H 3)', () => {
  it('H1/H3: every CP string sits in a gated file', () => {
    const ungated = [...hits.keys()].filter((f) => !(f in GATED));
    expect(
      ungated,
      'These files name a CP in a string and have no proof that it is hidden without one. Gate the words, then add the file to GATED with its test.'
    ).toEqual([]);
  });

  it('H1/H3: the allow-list has no stale entries, and each proof exists', () => {
    for (const [file, [testFile, testName]] of Object.entries(GATED)) {
      expect(hits.has(file), `${file} no longer names a CP; drop it`).toBe(
        true
      );
      const path = resolve(srcDir, testFile);
      expect(existsSync(path), `${testFile} is missing`).toBe(true);
      expect(
        readFileSync(path, 'utf8'),
        `${testFile} lacks "${testName}"`
      ).toContain(testName);
    }
  });

  it('H1/H2: the first-run guide and welcome card words name no CP at all', () => {
    expect(hits.has('constants/firstRunGuide.js')).toBe(false);
    expect(hits.has('components/FirstRunGuide.jsx')).toBe(false);
    expect(hits.has('components/TestersWelcomeCard.jsx')).toBe(false);
  });

  it('H1: the scan sees what it should (a known CP string is found)', () => {
    expect(hits.get('views/OverviewView.jsx')?.join(' ')).toMatch(/Rowing CP/);
  });
});
