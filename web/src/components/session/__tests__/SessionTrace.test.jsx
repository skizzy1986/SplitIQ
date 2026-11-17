import { render, screen } from '@testing-library/react';
import SessionTrace from '../SessionTrace.jsx';
import { createSeries, downsample } from '../../../utils/sessionSeries.js';
import {
  deriveCyclingZones,
  derivePaceZones,
} from '../../../constants/trainingConfig.js';
import { wattsToPace500 } from '../../../utils/pace.js';

vi.mock('recharts', () => import('../../../test/rechartsStub.jsx'));

const make = (n, channels) =>
  createSeries({
    source: 'test',
    t: Array.from({ length: n }, (_, i) => i),
    channels,
  });

const full = (n) =>
  make(n, {
    watts: Array.from({ length: n }, (_, i) => 150 + (i % 50)),
    hr: Array.from({ length: n }, (_, i) => 120 + (i % 30)),
    rate: Array(n).fill(22),
  });

describe('SessionTrace', () => {
  it('draws pace, heart rate and stroke rate for a row, all sharing one sync group and one rows array', () => {
    const s = full(2000);
    const rows = downsample(s, 'erg');
    render(
      <SessionTrace
        rows={rows}
        sport="erg"
        has={s.has}
        zones={derivePaceZones(200)}
        average={wattsToPace500(175)}
      />
    );
    const charts = screen.getAllByTestId('chart');
    expect(charts).toHaveLength(3);
    for (const c of charts) {
      expect(c).toHaveAttribute('data-sync', 'session-trace');
      expect(c).toHaveAttribute('data-points', '600');
    }
    expect(screen.getAllByTestId('line').map((l) => l.dataset.key)).toEqual([
      'pace',
      'hr',
      'rate',
    ]);
    for (const l of screen.getAllByTestId('line')) {
      expect(l).toHaveAttribute('data-dot', 'false');
      expect(l).toHaveAttribute('data-anim', 'false');
    }
    const axes = screen.getAllByTestId('y-axis');
    expect(axes.map((a) => a.dataset.unit)).toEqual(['/500 m', 'bpm', 'spm']);
    // Pace is drawn fast-at-top.
    expect(axes[0]).toHaveAttribute('data-reversed', 'true');
    // Every chart's tooltip is the custom one.
    for (const tip of screen.getAllByTestId('tooltip')) {
      expect(tip).toHaveAttribute('data-custom', 'true');
    }
    // Zone bands behind the first chart only, and a dashed average line.
    expect(screen.getAllByTestId('band').length).toBeGreaterThan(0);
    expect(screen.getByTestId('avg-line')).toHaveAttribute('data-dash', '4 4');
    // The time axis is labelled in real time.
    expect(screen.getAllByTestId('x-tick')[0]).toHaveTextContent('1:30');
  });

  it('labels each chart for assistive technology', () => {
    const s = full(100);
    render(
      <SessionTrace
        rows={downsample(s, 'erg')}
        sport="erg"
        has={s.has}
        average={wattsToPace500(175)}
      />
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute('aria-label')).toMatch(
      /^Pace across .* per 500 m; average \d:\d\d\.\d\.$/
    );
    expect(imgs[1].getAttribute('aria-label')).toMatch(
      /^Heart rate across .* bpm\.$/
    );
    expect(imgs[2].getAttribute('aria-label')).toMatch(
      /^Stroke rate .* spm\.$/
    );
  });

  it('draws power in watts for a ride, with Coggan bands', () => {
    const s = full(100);
    render(
      <SessionTrace
        rows={downsample(s, 'cycling')}
        sport="cycling"
        has={s.has}
        zones={deriveCyclingZones(200)}
        average={175}
      />
    );
    const axes = screen.getAllByTestId('y-axis');
    expect(axes.map((a) => a.dataset.unit)).toEqual(['W', 'bpm', 'rpm']);
    expect(axes[0]).toHaveAttribute('data-reversed', 'false');
    expect(screen.getAllByRole('img')[2].getAttribute('aria-label')).toMatch(
      /^Cadence/
    );
  });

  it('replaces a missing channel with one line and draws the others', () => {
    const s = make(100, {
      watts: Array(100).fill(180),
      rate: Array(100).fill(22),
    });
    render(
      <SessionTrace rows={downsample(s, 'erg')} sport="erg" has={s.has} />
    );
    expect(screen.getAllByTestId('chart')).toHaveLength(2);
    expect(
      screen.getByText('No heart rate was recorded for this session.')
    ).toBeInTheDocument();
  });

  it('omits the first chart and its zones on a ride with no power', () => {
    const s = make(100, { hr: Array(100).fill(130) });
    render(
      <SessionTrace
        rows={downsample(s, 'cycling')}
        sport="cycling"
        has={s.has}
        zones={deriveCyclingZones(200)}
      />
    );
    expect(screen.getAllByTestId('chart')).toHaveLength(1);
    expect(screen.queryByTestId('band')).toBeNull();
    expect(
      screen.getByText(
        'No power was recorded on this ride, so there is no power trace and no zones.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('No cadence was recorded for this session.')
    ).toBeInTheDocument();
  });
});
