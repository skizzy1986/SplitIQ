import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// Criterion 15: the session page is not coupled to Strava. Outside the one
// adapter, the one Strava hook, the source picker, the row reader and the one
// copy file, nothing on the page, in its components or in its calculations
// names Strava. A capture source then plugs in without touching any of them.

const SRC = join(process.cwd(), 'src');
const COMPONENTS = join(SRC, 'components', 'session');

const ALLOWED = [
  'utils/stravaSeries.js',
  'hooks/useStravaActivity.js',
  'hooks/useSessionSeries.js',
  'hooks/useSessionDetail.js',
  'components/session/sourceCopy.js',
];

const NEUTRAL = [
  'views/SessionView.jsx',
  'utils/sessionSeries.js',
  'utils/sessionAnalysis.js',
  'utils/sessionPage.js',
  ...readdirSync(COMPONENTS, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== 'sourceCopy.js')
    .map((d) => `components/session/${d.name}`),
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
  });

  it.each(NEUTRAL)('%s never names Strava', (rel) => {
    const text = readFileSync(join(SRC, rel), 'utf8');
    expect(/strava/i.test(text)).toBe(false);
  });

  it.each(ALLOWED)('%s exists (the allow-list is not stale)', (rel) => {
    expect(() => readFileSync(join(SRC, rel), 'utf8')).not.toThrow();
  });
});
