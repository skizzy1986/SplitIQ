import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

// Criterion 15: the session page is not coupled to Strava. Outside the one
// adapter, the one Strava hook, the source picker, the row reader and the one
// copy file, nothing on the page, in its components or in its calculations
// names Strava or speaks the importer's field vocabulary. A capture source
// then plugs in without touching any of them.

const SRC = join(process.cwd(), 'src');
const COMPONENTS = join(SRC, 'components', 'session');

const ALLOWED = [
  'utils/stravaSeries.js',
  'hooks/useStravaActivity.js',
  'hooks/useSessionSeries.js',
  'hooks/useSessionDetail.js',
  'components/session/sourceCopy.js',
];

// Every source file under components/session, at any depth, tests excluded.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : walk(full);
    return /\.(js|jsx)$/.test(d.name) ? [full] : [];
  });

const NEUTRAL = [
  'views/SessionView.jsx',
  'utils/sessionSeries.js',
  'utils/sessionAnalysis.js',
  'utils/sessionPage.js',
  ...walk(COMPONENTS)
    .map((f) => relative(SRC, f).split('\\').join('/'))
    .filter((f) => !ALLOWED.includes(f)),
];

// The source's name, and the words its payload and importer use.
const FORBIDDEN = [
  /strava/i,
  /velocity_smooth/,
  /heartrate/i,
  /device_watts/,
  /garmin/i,
  /\badopted\b/i,
  /\binserted\b/i,
];

describe('the source-neutral seam', () => {
  it('scans every component in components/session', () => {
    for (const name of [
      'SessionSummary.jsx',
      'SessionTrace.jsx',
      'TraceTooltip.jsx',
      'ZoneBar.jsx',
      'ProvenanceNote.jsx',
      'SessionState.jsx',
      'zoneLabels.js',
    ]) {
      expect(NEUTRAL).toContain(`components/session/${name}`);
    }
    expect(NEUTRAL).not.toContain('components/session/sourceCopy.js');
  });

  it.each(NEUTRAL)('%s never names the source or its vocabulary', (rel) => {
    const text = readFileSync(join(SRC, rel), 'utf8');
    const hits = FORBIDDEN.filter((re) => re.test(text)).map(String);
    expect(hits).toEqual([]);
  });

  it.each(ALLOWED)('%s exists (the allow-list is not stale)', (rel) => {
    expect(() => readFileSync(join(SRC, rel), 'utf8')).not.toThrow();
  });
});
