import { SENTRY_INIT_MARKERS, sentryInitProblems } from '../entry-graph.mjs';

// #465: a build without VITE_SENTRY_DSN tree-shakes Sentry.init out of the
// shared entry, so the size gate measured ~49 KB less than production ships.
describe('sentryInitProblems', () => {
  const withInit = {
    file: 'index-a.js',
    text: `x={name:"GlobalHandlers"};y={name:"BrowserTracing"}`,
  };
  const withoutInit = { file: 'index-a.js', text: 'captureException(e)' };
  const authGate = { file: 'AuthGate-b.js', text: 'z()' };

  it('passes when every first paint carries the init path', () => {
    expect(
      sentryInitProblems([
        { name: 'dashboard', files: [withInit, authGate] },
        { name: '/squat', files: [withInit] },
      ])
    ).toEqual([]);
  });

  it('fails each product whose first paint lacks it, naming the fix', () => {
    const problems = sentryInitProblems([
      { name: 'dashboard', files: [withoutInit, authGate] },
      { name: '/squat', files: [withoutInit] },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/dashboard first paint has no Sentry init/);
    expect(problems[0]).toMatch(/GlobalHandlers, BrowserTracing/);
    expect(problems[0]).toMatch(/VITE_SENTRY_DSN=https:\/\/[0-9a-f]{32}@o0\./);
    expect(problems[1]).toMatch(/\/squat first paint/);
  });

  it('fails when only the tracing integration is gone', () => {
    const noTracing = { file: 'index-a.js', text: '{name:"GlobalHandlers"}' };
    expect(
      sentryInitProblems([{ name: 'dashboard', files: [noTracing] }])
    ).toEqual([expect.stringContaining('missing BrowserTracing')]);
  });

  it('looks for markers the real SDK keeps through minification', () => {
    expect(SENTRY_INIT_MARKERS).toEqual(['GlobalHandlers', 'BrowserTracing']);
  });
});
