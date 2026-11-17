import { fireEvent, render, screen } from '@testing-library/react';
import { createSeries } from '../../utils/sessionSeries.js';
import { seriesFromStrava } from '../../utils/stravaSeries.js';
import {
  ACTIVITY_URL,
  captureSeries,
  ergRow,
  spoken,
  stravaOkBody,
  traceStates,
} from '../../test/sessionFixtures.js';

vi.mock('recharts', () => import('../../test/rechartsStub.jsx'));

const mocks = vi.hoisted(() => ({
  detail: null,
  series: null,
  anchors: null,
  sessions: [],
}));
vi.mock('../../hooks/useSessionDetail.js', () => ({
  useSessionDetail: () => mocks.detail,
}));
vi.mock('../../hooks/useSessionSeries.js', () => ({
  useSessionSeries: () => mocks.series,
}));
vi.mock('../../hooks/useAnchors.js', () => ({
  useAnchors: () => mocks.anchors,
}));
vi.mock('../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: mocks.sessions }),
}));

import SessionView from '../SessionView.jsx';

const detail = (data, over = {}) => ({
  data,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  ...over,
});
const seriesState = (state, over = {}) => ({
  state,
  reason: null,
  source: null,
  series: null,
  retryAt: null,
  refetch: vi.fn(),
  ...over,
});
const ready = (series) =>
  seriesState('ready', { source: series.source, series });

beforeEach(() => {
  mocks.detail = detail(ergRow());
  mocks.series = ready(seriesFromStrava(stravaOkBody()));
  mocks.anchors = {
    cp: 200,
    cpStatus: 'confirmed',
    ftp: 250,
    ftpStatus: 'provisional',
  };
  mocks.sessions = [];
});

const charts = () => screen.queryAllByTestId('chart');
const view = (props = {}) =>
  render(<SessionView sessionId={4242} onBack={() => {}} {...props} />);

// Words that would turn a description into a verdict or an instruction.
const VERDICT =
  /\b(should|must|too|good|bad|great|poor|better|worse|need to|try|keep it|well done|excellent)\b/i;

const STATES = traceStates();

describe('SessionView — ready, at the simple depth', () => {
  it('shows a headline, the summary, the trace and time in zone', () => {
    view();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Steady row' })
    ).toHaveFocus();
    expect(
      // The fixture splits its time evenly between AT and TR: no zone named.
      screen.getByText('30 minutes of rowing at an average 2:05.0 /500 m.')
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(charts()).toHaveLength(3);
    expect(screen.getByText('Time in zone')).toBeInTheDocument();
    expect(
      screen.getByText('Zones from your rowing CP, 200 W (confirmed).')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View on Strava' })
    ).toHaveAttribute('href', ACTIVITY_URL);
  });

  it('shows no link when the answer carries no url, and still says where the data came from', () => {
    mocks.series = ready(
      seriesFromStrava({ ...stravaOkBody(), url: undefined })
    );
    view();
    expect(screen.queryByRole('link', { name: 'View on Strava' })).toBeNull();
    expect(screen.getByText('Imported from Strava.')).toBeInTheDocument();
    expect(charts()).toHaveLength(3);
  });

  it('names the zone in the headline when one holds most of the time', () => {
    mocks.series = ready(
      createSeries({
        source: 'test',
        t: Array.from({ length: 600 }, (_, i) => i),
        channels: { watts: Array(600).fill(190) },
      })
    );
    view();
    expect(
      screen.getByText(
        '30 minutes of rowing at an average 2:05.0 /500 m, most of it in TR.'
      )
    ).toBeInTheDocument();
  });

  it('uses a singular for one minute', () => {
    mocks.detail = detail(ergRow({ duration: '1:00', distance_m: 240 }));
    view();
    expect(
      screen.getByText('1 minute of rowing at an average 2:05.0 /500 m.')
    ).toBeInTheDocument();
  });

  it('draws each chart’s dashed average at the figure the summary shows', () => {
    // The stored row says 7000 m in 30:00 (2:08.6) and 140 bpm; the trace on
    // its own would say 2:05.0. The page shows one average per quantity.
    mocks.detail = detail(ergRow({ distance_m: 7000, avg_hr: 140 }));
    view();
    expect(document.querySelector('[data-tile="pace"]')).toHaveTextContent(
      '2:08.6 /500 m'
    );
    const [paceLine, hrLine, rateLine] = screen.getAllByTestId('avg-line');
    expect(Number(paceLine.dataset.y)).toBeCloseTo((500 * 1800) / 7000);
    expect(Number(hrLine.dataset.y)).toBe(140);
    // No stored rate: the trace's own average.
    expect(Number(rateLine.dataset.y)).toBe(22);
    expect(screen.getAllByRole('img')[0].getAttribute('aria-label')).toMatch(
      /average 2:08\.6\.$/
    );
  });

  it('falls back to the trace average when the stored row has none', () => {
    mocks.detail = detail(
      ergRow({ distance_m: null, avg_watts: null, avg_hr: null })
    );
    view();
    const [paceLine, hrLine] = screen.getAllByTestId('avg-line');
    expect(Number(paceLine.dataset.y)).toBeCloseTo(125, 0);
    expect(Number(hrLine.dataset.y)).toBeGreaterThan(130);
  });

  it('describes, and never judges or instructs, in any state, aria-labels included', () => {
    for (const state of STATES) {
      mocks.series = state;
      const { container, unmount } = view();
      expect(spoken(container), state.state).not.toMatch(VERDICT);
      unmount();
    }
  });

  it('grounds power against the athlete’s own prior 30 days', () => {
    mocks.sessions = [
      { ...ergRow({ id: 1, date_iso: '2026-11-01', avg_watts: 170 }) },
      { ...ergRow({ id: 2, date_iso: '2026-11-03', avg_watts: 175 }) },
      { ...ergRow({ id: 3, date_iso: '2026-11-05', avg_watts: 165 }) },
    ];
    view();
    expect(
      screen.getByText(
        'Average power 180 W. Your rowing sessions in the 30 days before averaged 170 W across 3 sessions.'
      )
    ).toBeInTheDocument();
  });

  it('calls onBack from the Back button', () => {
    const onBack = vi.fn();
    view({ onBack, backLabel: 'Back to History' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to History' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('SessionView — states, none drawing a chart', () => {
  it('loading: a busy skeleton', () => {
    mocks.detail = detail(undefined, { isPending: true });
    view();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(charts()).toHaveLength(0);
  });

  it('a trace still loading: summary plus a busy skeleton', () => {
    mocks.series = seriesState('loading', { source: 'strava' });
    view();
    expect(
      screen.getByRole('status', { name: 'Loading the trace' })
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
  });

  it('not found (no row, including another user’s id)', () => {
    mocks.detail = detail(null);
    view();
    expect(
      screen.getByText('There is no session with this id in your log.')
    ).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
  });

  it('the row failed to load: Retry is a real button', () => {
    const refetch = vi.fn();
    mocks.detail = detail(undefined, { isError: true, refetch });
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
    expect(charts()).toHaveLength(0);
  });

  it('wrong sport', () => {
    mocks.detail = detail(ergRow({ type: 'strength', label: 'Upper 1' }));
    view();
    expect(
      screen.getByText('Only completed rowing and cycling sessions open here.')
    ).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
  });

  it('summary only, for a session logged in the app', () => {
    mocks.detail = detail(
      ergRow({ source: 'portal', strava_activity_id: null })
    );
    mocks.series = seriesState('none');
    view();
    expect(
      screen.getByText(
        'This session has a summary only; no trace is linked to it.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Summary from your log.')).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
  });

  it('an imported session says so with no trace, loading, unavailable or errored', () => {
    for (const state of [
      seriesState('none'),
      seriesState('loading', { source: 'strava' }),
      seriesState('unavailable', { source: 'strava', reason: 'gone' }),
      seriesState('error', { source: 'strava' }),
    ]) {
      mocks.series = state;
      const { unmount } = view();
      expect(
        screen.getByText('Imported from Strava.'),
        state.state
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View on Strava' })).toBeNull();
      unmount();
    }
  });

  it('an activity with no recorded trace is worded apart from no linked activity', () => {
    mocks.series = seriesState('none', {
      source: 'strava',
      reason: 'no_trace',
    });
    view();
    expect(
      screen.getByText('Strava holds no recorded trace for this activity.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'This session has a summary only; no trace is linked to it.'
      )
    ).toBeNull();
    expect(charts()).toHaveLength(0);
  });

  it.each([
    [
      'not_connected',
      'Strava is not connected, so there is no trace for this session.',
    ],
    [
      'auth_failed',
      'Strava refused the current grant, so the trace did not load.',
    ],
    ['gone', 'This activity is no longer on Strava, so there is no trace.'],
    [
      'attribution_pending',
      'This activity was recorded on a Garmin device. Its trace appears once Garmin attribution is in place.',
    ],
  ])('unavailable: %s', (reason, text) => {
    mocks.series = seriesState('unavailable', { source: 'strava', reason });
    view();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
    if (reason === 'not_connected' || reason === 'auth_failed') {
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
        'href',
        '#/settings'
      );
    }
  });

  it('unavailable: rate limited, with the retry time', () => {
    const retryAt = new Date(2026, 10, 10, 9, 15).toISOString();
    mocks.series = seriesState('unavailable', {
      source: 'strava',
      reason: 'rate_limited',
      retryAt,
    });
    view();
    expect(
      screen.getByText(
        'Strava’s request limit is reached. The trace can load again after 09:15.'
      )
    ).toBeInTheDocument();
    expect(charts()).toHaveLength(0);
  });

  it('error: the summary plus Retry', () => {
    const refetch = vi.fn();
    mocks.series = seriesState('error', { source: 'strava', refetch });
    view();
    expect(
      screen.getByText('The trace could not be loaded.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
    expect(charts()).toHaveLength(0);
  });

  it('one channel missing: that chart is one line, the others drawn', () => {
    mocks.series = ready(seriesFromStrava(stravaOkBody({ hr: false })));
    view();
    expect(charts()).toHaveLength(2);
    expect(
      screen.getByText('No heart rate was recorded for this session.')
    ).toBeInTheDocument();
  });

  it('no anchor: zones need one, and none are drawn', () => {
    mocks.anchors = { cp: null, cpStatus: null, ftp: null, ftpStatus: null };
    view();
    expect(
      screen.getByText(
        'Zones need a rowing CP anchor, and none is set, so no zones are drawn.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('band')).toBeNull();
  });
});

describe('SessionView — a ride', () => {
  // A synthetic ride: 40 minutes at a steady 200 W, FTP 250 (Z3 tempo).
  const ride = () =>
    createSeries({
      source: 'strava',
      t: Array.from({ length: 2401 }, (_, i) => i),
      channels: {
        watts: Array(2401).fill(200),
        hr: Array(2401).fill(140),
        rate: Array(2401).fill(88),
        dist: Array.from({ length: 2401 }, (_, i) => i * 8),
        speed: Array(2401).fill(8),
      },
    });

  it('draws power with FTP zones and says so in the headline', () => {
    mocks.detail = detail(
      ergRow({
        type: 'cycling',
        label: 'Tempo ride',
        duration: '40:00',
        distance_m: 19200,
        avg_watts: 200,
        srpe: null,
      })
    );
    mocks.series = ready(ride());
    view();
    expect(
      screen.getByText(
        '40 minutes of cycling at an average 200 W, most of it in Z3 Tempo.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('y-axis').map((a) => a.dataset.unit)).toEqual([
      'W',
      'bpm',
      'rpm',
    ]);
    expect(screen.getAllByTestId('band')).toHaveLength(
      screen.getAllByTestId('band').length
    );
    expect(screen.getAllByTestId('band').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Zones from your bike FTP, 250 W (provisional).')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Scored from average power 200 W against your bike FTP 250 W (intensity 0.80).'
      )
    ).toBeInTheDocument();
    expect(document.querySelector('[data-tile="speed"]')).toHaveTextContent(
      '28.8 km/h'
    );
  });
});

describe('SessionView — a source that is not Strava', () => {
  it('renders and computes a per-stroke series with an extra channel, with no Strava wording', () => {
    mocks.detail = detail(
      ergRow({ source: 'portal', strava_activity_id: null, duration: '0:33' })
    );
    mocks.series = ready(captureSeries());
    const { container } = view();
    expect(charts()).toHaveLength(3);
    expect(screen.getByText('Time in zone')).toBeInTheDocument();
    expect(document.querySelector('[data-tile="maxWatts"]')).toHaveTextContent(
      '220 W'
    );
    expect(screen.getByText('Summary from your log.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/strava/i);
  });

  it('draws a ride from a captured series', () => {
    mocks.detail = detail(
      ergRow({
        type: 'cycling',
        label: 'Trainer ride',
        strava_activity_id: null,
      })
    );
    mocks.series = ready(
      createSeries({
        source: 'capture',
        t: Array.from({ length: 120 }, (_, i) => i),
        channels: {
          watts: Array(120).fill(180),
          hr: Array(120).fill(130),
          rate: Array(120).fill(88),
        },
      })
    );
    const { container } = view();
    expect(screen.getAllByTestId('y-axis').map((a) => a.dataset.unit)).toEqual([
      'W',
      'bpm',
      'rpm',
    ]);
    expect(container.textContent).not.toMatch(/strava/i);
  });
});

describe('SessionView — selecting a stretch, splits and more detail', () => {
  const range = () => screen.queryByRole('region', { name: 'Selected range' });
  const rangeValue = (key) =>
    document.querySelector(`[data-range="${key}"] dd`)?.textContent;
  const areas = () =>
    screen
      .queryAllByTestId('selection')
      .map((a) => [Number(a.dataset.x1), Number(a.dataset.x2)]);
  // The stub reads the hovered row's index from clientX. A move during a
  // drag holds the button down (buttons: 1).
  const drag = (from, to) => {
    const chart = charts()[0];
    fireEvent.mouseDown(chart, { clientX: from, buttons: 1 });
    fireEvent.mouseMove(chart, { clientX: to, buttons: 1 });
    fireEvent.mouseUp(chart, { clientX: to });
  };
  const liveRegion = (name) => document.querySelector(`[data-live="${name}"]`);

  it('a drag across the trace selects that stretch on all three charts and summarises it', () => {
    view();
    expect(range()).toBeNull();
    // Rows are grouped four samples to a row here: row 10 covers 40 to 44 s
    // and row 100 covers 400 to 404 s, so the selection runs to 404 s.
    drag(10, 100);
    expect(range()).toBeInTheDocument();
    expect(areas()).toEqual([
      [40, 404],
      [40, 404],
      [40, 404],
    ]);
    expect(rangeValue('moving')).toBe('6:04');
    expect(rangeValue('distance')).toMatch(/^1\.46\u00a0km$/);
    expect(rangeValue('watts')).toMatch(/^176\u00a0W$/);
  });

  it('above 600 samples a drag covers both end rows whole, in either direction', () => {
    view();
    drag(100, 10);
    expect(areas()[0]).toEqual([40, 404]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    // Two neighbouring rows: both groups, eight samples.
    drag(10, 11);
    expect(areas()[0]).toEqual([40, 48]);
    expect(rangeValue('moving')).toBe('0:08');
  });

  it('at or below 600 samples a drag is exact, sample to sample', () => {
    mocks.series = ready(seriesFromStrava(stravaOkBody({ n: 300 })));
    view();
    drag(100, 10);
    expect(areas()[0]).toEqual([10, 100]);
    expect(rangeValue('moving')).toBe('1:30');
  });

  it('a move with no button held ends a drag released outside the window', () => {
    view();
    const chart = charts()[0];
    fireEvent.mouseDown(chart, { clientX: 10, buttons: 1 });
    fireEvent.mouseMove(chart, { clientX: 50, buttons: 1 });
    // Released outside: no mouseup arrives, and the pointer comes back with
    // no button down.
    fireEvent.mouseMove(chart, { clientX: 90, buttons: 0 });
    expect(range()).toBeInTheDocument();
    expect(areas()[0]).toEqual([40, 204]);
    // The drag is over: a later move changes nothing.
    fireEvent.mouseMove(chart, { clientX: 120, buttons: 1 });
    expect(areas()[0]).toEqual([40, 204]);
  });

  it('a drag puts its summary under the trace, in a polite live region', () => {
    view();
    expect(liveRegion('trace')).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion('trace')).toBeEmptyDOMElement();
    drag(10, 100);
    expect(liveRegion('trace')).toContainElement(range());
    expect(liveRegion('splits')).toBeEmptyDOMElement();
  });

  it('a split row puts its summary directly above the splits table, in a polite live region', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    const region = liveRegion('splits');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toContainElement(range());
    expect(liveRegion('trace')).toBeEmptyDOMElement();
    // Next to the control that made it: the table follows the summary.
    expect(region.nextElementSibling).toContainElement(
      screen.getByRole('table')
    );
  });

  it('a drag that ends on another chart still selects', () => {
    view();
    fireEvent.mouseDown(charts()[0], { clientX: 10, buttons: 1 });
    fireEvent.mouseMove(charts()[1], { clientX: 50, buttons: 1 });
    fireEvent.mouseUp(window);
    expect(areas()).toHaveLength(3);
    expect(range()).toBeInTheDocument();
  });

  it('a click without a drag selects nothing', () => {
    view();
    const chart = charts()[0];
    fireEvent.mouseDown(chart, { clientX: 10 });
    fireEvent.mouseUp(chart, { clientX: 10 });
    expect(range()).toBeNull();
    expect(areas()).toEqual([]);
  });

  it('Clear and Escape return to the whole session', () => {
    view();
    drag(10, 100);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(range()).toBeNull();
    expect(areas()).toEqual([]);
    drag(10, 100);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(range()).toBeNull();
    expect(areas()).toEqual([]);
  });

  it('a split button selects the split, shades it, and pressing it again clears', () => {
    view();
    expect(screen.getByText('Splits')).toBeInTheDocument();
    const table = screen.getByRole('table');
    // 7200 m at 4 m/s, a 1 s pause: 14 full 500 m splits and a partial.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(15);
    const one = screen.getByRole('button', { name: '1' });
    fireEvent.click(one);
    expect(one).toHaveAttribute('aria-pressed', 'true');
    expect(rangeValue('moving')).toBe('2:05');
    expect(rangeValue('distance')).toMatch(/^500\u00a0m$/);
    expect(areas()).toEqual([
      [0, 125],
      [0, 125],
      [0, 125],
    ]);
    fireEvent.click(one);
    expect(range()).toBeNull();
    expect(one).toHaveAttribute('aria-pressed', 'false');
  });

  it('changing the split distance re-splits and drops a split selection', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: /^1\.00\u00a0km$/ }));
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(
      8
    );
    expect(range()).toBeNull();
  });

  it('More detail opens on peak power, weighted power, variability and drift', () => {
    view();
    const more = screen.getByRole('button', { name: 'More detail' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    for (const name of [
      'Peak power, 1 min',
      'Peak power, 20 min',
      'Weighted power',
      'Variability',
      'Drift',
    ]) {
      expect(screen.getByText(name)).toBeVisible();
    }
  });

  it('draws no splits and no detail outside a ready trace', () => {
    for (const state of STATES.filter((s) => s.state !== 'ready')) {
      mocks.series = state;
      const { unmount } = view();
      expect(screen.queryByRole('table'), state.state).toBeNull();
      expect(screen.queryByRole('button', { name: 'More detail' })).toBeNull();
      expect(screen.queryByText('Splits')).toBeNull();
      unmount();
    }
  });
});

describe('SessionView — splits for a ride, and a selection that outlives its series', () => {
  const rideRow = ergRow({
    type: 'cycling',
    label: 'Ride',
    duration: '40:00',
    distance_m: 19200,
    avg_watts: 200,
    srpe: null,
  });
  // 40 minutes at 8 m/s; laps and the distance channel as asked.
  const ride = ({ laps = [], distance = true } = {}) =>
    createSeries({
      source: 'capture',
      t: Array.from({ length: 2401 }, (_, i) => i),
      channels: {
        watts: Array(2401).fill(200),
        hr: Array(2401).fill(140),
        rate: Array(2401).fill(88),
        dist: distance ? Array.from({ length: 2401 }, (_, i) => i * 8) : null,
      },
      laps,
    });

  it('a ride with two laps shows one row per lap', () => {
    mocks.detail = detail(rideRow);
    mocks.series = ready(
      ride({
        laps: [
          { i0: 0, i1: 1200 },
          { i0: 1200, i1: 2400 },
        ],
      })
    );
    view();
    const table = screen.getByRole('table', {
      name: 'One row per recorded lap.',
    });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Lap');
    expect(
      screen.queryByRole('navigation', { name: 'Split distance' })
    ).toBeNull();
  });

  it('a ride with one lap is split every 5 km', () => {
    mocks.detail = detail(rideRow);
    mocks.series = ready(ride({ laps: [{ i0: 0, i1: 2400 }] }));
    view();
    const table = screen.getByRole('table', {
      name: 'One row every 5.00\u00a0km.',
    });
    // 19 200 m: three full 5 km splits and a partial 4.2 km.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: '4 (partial)' })
    ).toBeInTheDocument();
  });

  it('a ride with no distance channel has no Splits section', () => {
    mocks.detail = detail(rideRow);
    mocks.series = ready(ride({ distance: false }));
    view();
    expect(screen.queryByText('Splits')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // The rest of the page is still there.
    expect(
      screen.getByRole('button', { name: 'More detail' })
    ).toBeInTheDocument();
  });

  it('a new series clears a selection made on the old one', () => {
    const { rerender } = view();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(
      screen.getByRole('region', { name: 'Selected range' })
    ).toBeInTheDocument();
    mocks.series = ready(seriesFromStrava(stravaOkBody()));
    rerender(<SessionView sessionId={4242} onBack={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Selected range' })).toBeNull();
    expect(screen.queryAllByTestId('selection')).toEqual([]);
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});

describe('SessionView — heart rate against the athlete’s own history', () => {
  const prior = (n) =>
    [170, 175, 165, 172].slice(0, n).map((w, i) =>
      ergRow({
        id: i + 1,
        date_iso: `2026-11-0${i + 1}`,
        avg_watts: w,
        avg_hr: 144 + i,
      })
    );

  it('grounds the heart-rate chart with three or more prior sessions', () => {
    mocks.sessions = prior(3);
    view();
    expect(
      screen.getByText(
        'Average heart rate 140 bpm. Your rowing sessions in the 30 days before averaged 145 bpm across 3 sessions.'
      )
    ).toBeInTheDocument();
  });

  it('says nothing about history with fewer than three', () => {
    mocks.sessions = prior(2);
    const { container } = view();
    expect(container.textContent).not.toMatch(/averaged \d+ bpm/);
  });
});
