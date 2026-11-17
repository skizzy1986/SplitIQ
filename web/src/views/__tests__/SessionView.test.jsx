import { fireEvent, render, screen } from '@testing-library/react';
import { createSeries } from '../../utils/sessionSeries.js';
import { seriesFromStrava } from '../../utils/stravaSeries.js';
import {
  ACTIVITY_URL,
  captureSeries,
  ergRow,
  stravaOkBody,
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

  it('describes, and never judges or instructs', () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(VERDICT);
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

  it('summary only', () => {
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
