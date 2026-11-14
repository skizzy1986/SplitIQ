// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWS_SOURCES } from '../../../lingui.config.js';

// A file whose messages are not in VIEWS_SOURCES is extracted into the boot
// catalog (src/locales/en.po), which AuthGate loads on first paint, where the
// entry budget has almost no room. A translated view that someone forgets to
// list therefore grows the entry bundle silently. This pins the split: every
// file that writes messages is either listed or named below.

// The boot catalog's legitimate sources: everything a visitor can see before
// the lazy shells' chunk arrives (login, splash, the mobile tab names). Adding
// a file here puts its words on first paint, so it needs a reason.
const BOOT_ALLOWLIST = [
  'src/AuthGate.jsx', // login, sign-out, install prompt
  'src/components/SplashScreen.jsx',
  'src/constants/destinations.js', // mobile tab names
  'src/utils/authError.js',
  // Not first-paint screens: they are here only because they are not yet in
  // VIEWS_SOURCES (four short strings between them). Move them, don't add more.
  'src/views/ErgView.jsx',
  'src/views/StrengthView.jsx',
  'src/views/mobile/MobileStrength.jsx',
];

// /squat and the anatomy runtime have their own catalog (src/squat/locales).
const OWN_CATALOG = ['src/squat/', 'src/anatomy/'];
// Matches what extraction reads: a macro import. A commented-out import
// false-positives loudly, which is the safe direction; do not loosen it.
const MACRO_IMPORT = /from\s+['"]@lingui\/(?:core|react)\/macro['"]/;

// messageFiles: files that import a Lingui macro, so extraction reads them.
// allFiles: every source file. A VIEWS_SOURCES entry may use Lingui without
// writing messages (LoadTooltip reads the locale), so for that list only a
// moved or deleted file counts as stale.
function catalogPlacement({
  messageFiles,
  allFiles,
  viewsSources,
  bootAllowlist,
}) {
  const files = new Set(messageFiles);
  const all = new Set(allFiles);
  const views = new Set(viewsSources);
  const boot = new Set(bootAllowlist);
  return {
    unlisted: messageFiles.filter((f) => !views.has(f) && !boot.has(f)),
    staleViews: viewsSources.filter((f) => !all.has(f)),
    staleBoot: bootAllowlist.filter((f) => !files.has(f) || views.has(f)),
  };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

function sourceFiles() {
  // web/, from this file, so the test does not depend on where vitest runs.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  return walk(join(root, 'src'))
    .map((p) => relative(root, p).split(sep).join('/'))
    .filter((f) => !OWN_CATALOG.some((d) => f.startsWith(d)))
    .sort()
    .map((path) => ({
      path,
      writesMessages: MACRO_IMPORT.test(readFileSync(join(root, path), 'utf8')),
    }));
}

describe('dashboard catalog placement', () => {
  it('lists every file that writes messages in VIEWS_SOURCES or the boot allowlist', () => {
    const files = sourceFiles();
    const messageFiles = files
      .filter((f) => f.writesMessages)
      .map((f) => f.path);
    // The walker must see real message files, not just a non-empty list.
    for (const known of [
      'src/AuthGate.jsx',
      'src/views/ErgLiveView.jsx',
      'src/components/WorkoutTarget.jsx',
      'src/views/mobile/MobileTrain.jsx',
    ])
      expect(messageFiles).toContain(known);
    expect(
      catalogPlacement({
        messageFiles,
        allFiles: files.map((f) => f.path),
        viewsSources: VIEWS_SOURCES,
        bootAllowlist: BOOT_ALLOWLIST,
      })
    ).toEqual({ unlisted: [], staleViews: [], staleBoot: [] });
  });

  it('includes the erg path Train hands the screen to', () => {
    for (const f of [
      'src/views/ErgLiveView.jsx',
      'src/components/WorkoutTarget.jsx',
      'src/constants/pm5ErrorMessages.js',
      'src/utils/durationLabel.js',
    ]) {
      expect(VIEWS_SOURCES).toContain(f);
    }
  });
});

describe('catalogPlacement', () => {
  const base = {
    messageFiles: ['src/a.jsx', 'src/b.jsx'],
    allFiles: ['src/a.jsx', 'src/b.jsx', 'src/c.jsx'],
    viewsSources: ['src/a.jsx'],
    bootAllowlist: ['src/b.jsx'],
  };

  it('passes when every file is placed exactly once', () => {
    expect(catalogPlacement(base)).toEqual({
      unlisted: [],
      staleViews: [],
      staleBoot: [],
    });
  });

  it('fails a newly added file that is in neither list', () => {
    expect(
      catalogPlacement({
        ...base,
        messageFiles: [...base.messageFiles, 'src/views/New.jsx'],
      }).unlisted
    ).toEqual(['src/views/New.jsx']);
  });

  it('fails a boot allowlist entry whose file no longer writes messages', () => {
    expect(
      catalogPlacement({ ...base, messageFiles: ['src/a.jsx'] }).staleBoot
    ).toEqual(['src/b.jsx']);
  });

  it('fails a boot allowlist entry that has moved to VIEWS_SOURCES', () => {
    expect(
      catalogPlacement({ ...base, viewsSources: ['src/a.jsx', 'src/b.jsx'] })
        .staleBoot
    ).toEqual(['src/b.jsx']);
  });

  it('fails a VIEWS_SOURCES entry whose file is gone', () => {
    expect(
      catalogPlacement({ ...base, viewsSources: ['src/a.jsx', 'src/gone.jsx'] })
        .staleViews
    ).toEqual(['src/gone.jsx']);
  });
});
