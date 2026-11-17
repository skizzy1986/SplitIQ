import { render, screen } from '@testing-library/react';
import SessionTrace, { bandsFor, domainOf } from '../SessionTrace.jsx';
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
        averages={{ first: wattsToPace500(175), hr: 134, rate: 22 }}
      />
    );
    const charts = screen.getAllByTestId('chart');
    expect(charts).toHaveLength(3);
    for (const c of charts) {
      expect(c).toHaveAttribute('data-sync', 'session-trace');
      expect(c).toHaveAttribute('data-points', String(rows.length));
    }
    expect(rows.length).toBeLessThanOrEqual(600);
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
    // Each chart's tooltip is the custom one, showing that chart's series.
    const tips = screen.getAllByTestId('tooltip');
    expect(tips.map((tip) => tip.dataset.chart)).toEqual([
      'first',
      'hr',
      'rate',
    ]);
    for (const tip of tips) expect(tip).toHaveAttribute('data-custom', 'true');
    // Zone bands behind the first chart only.
    expect(screen.getAllByTestId('band').length).toBeGreaterThan(0);
    // The time axis is labelled in real time.
    expect(screen.getAllByTestId('x-tick')[0]).toHaveTextContent('1:30');
  });

  it('draws a dashed session-average line on every chart, at the figure given', () => {
    const s = full(100);
    const pace = wattsToPace500(175);
    render(
      <SessionTrace
        rows={downsample(s, 'erg')}
        sport="erg"
        has={s.has}
        averages={{ first: pace, hr: 134, rate: 22 }}
      />
    );
    const lines = screen.getAllByTestId('avg-line');
    expect(lines.map((l) => Number(l.dataset.y))).toEqual([pace, 134, 22]);
    for (const l of lines) expect(l).toHaveAttribute('data-dash', '4 4');
    // The domain stretches to hold the average, so the line is never clipped.
    const [first] = screen.getAllByTestId('y-axis');
    const [lo, hi] = first.dataset.domain.split(',').map(Number);
    expect(pace).toBeGreaterThanOrEqual(lo);
    expect(pace).toBeLessThanOrEqual(hi);
  });

  it('labels each chart, average included, for assistive technology', () => {
    const s = full(100);
    render(
      <SessionTrace
        rows={downsample(s, 'erg')}
        sport="erg"
        has={s.has}
        averages={{ first: wattsToPace500(175), hr: 134, rate: 22 }}
      />
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute('aria-label')).toMatch(
      /^Pace across .* per 500 m; average \d:\d\d\.\d\.$/
    );
    expect(imgs[1].getAttribute('aria-label')).toMatch(
      /^Heart rate across .* bpm; average 134 bpm\.$/
    );
    expect(imgs[2].getAttribute('aria-label')).toMatch(
      /^Stroke rate .* spm; average 22 spm\.$/
    );
  });

  it('omits an average line, and its words, when the average is unknown', () => {
    const s = full(100);
    render(
      <SessionTrace rows={downsample(s, 'erg')} sport="erg" has={s.has} />
    );
    expect(screen.queryByTestId('avg-line')).toBeNull();
    expect(screen.getAllByRole('img')[1].getAttribute('aria-label')).toMatch(
      /bpm\.$/
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
        averages={{ first: 175, hr: null, rate: 22 }}
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

describe('zone band geometry', () => {
  it('rowing bands sit in pace, run fast-to-slow, and the open top band reaches the fast edge', () => {
    const zones = derivePaceZones(200);
    const bands = bandsFor(zones, 'erg', [100, 140]);
    const by = Object.fromEntries(bands.map((b) => [b.key, b]));
    // AN is open-ended: it runs from the fast edge of the axis to 210 W.
    expect(by.AN.y1).toBe(100);
    expect(by.AN.y2).toBeCloseTo(wattsToPace500(210));
    // Neighbouring bands meet: AN's slow edge is TR's fast edge.
    expect(by.TR.y1).toBeCloseTo(by.AN.y2);
    expect(by.TR.y2).toBeCloseTo(wattsToPace500(180));
    // Recovery (below 110 W, slower than 2:27) lies wholly off a 2:20 axis.
    expect(by.Recovery).toBeUndefined();
    for (const b of bands) {
      expect(b.y1).toBeGreaterThanOrEqual(100);
      expect(b.y2).toBeLessThanOrEqual(140);
      expect(b.y2).toBeGreaterThan(b.y1);
    }
  });

  it('clips a band that straddles the axis to the domain', () => {
    const bands = bandsFor(derivePaceZones(200), 'erg', [120, 130]);
    const tr = bands.find((b) => b.key === 'TR');
    expect(tr.y1).toBe(120);
    expect(tr.y2).toBeCloseTo(wattsToPace500(180));
    // UT1 (140-160 W) runs past the slow edge and stops at it.
    const ut1 = bands.find((b) => b.key === 'UT1');
    expect(ut1.y1).toBeCloseTo(wattsToPace500(160));
    expect(ut1.y2).toBe(130);
    expect(bands.find((b) => b.key === 'UT2')).toBeUndefined();
  });

  it('cycling bands sit in watts, the open Z7 reaching the top of the axis', () => {
    const bands = bandsFor(deriveCyclingZones(200), 'cycling', [100, 400]);
    const by = Object.fromEntries(bands.map((b) => [b.key, b]));
    expect(by.active_recovery).toMatchObject({ y1: 100, y2: 110 });
    expect(by.neuromuscular).toMatchObject({ y1: 300, y2: 400 });
    expect(bands).toHaveLength(7);
  });

  it('the chart draws exactly the computed bands', () => {
    const s = full(100);
    const rows = downsample(s, 'erg');
    const zones = derivePaceZones(200);
    render(<SessionTrace rows={rows} sport="erg" has={s.has} zones={zones} />);
    const expected = bandsFor(zones, 'erg', domainOf(rows, 'pace'));
    const drawn = screen.getAllByTestId('band');
    expect(
      drawn.map((b) => [Number(b.dataset.y1), Number(b.dataset.y2)])
    ).toEqual(expected.map((b) => [b.y1, b.y2]));
  });
});
