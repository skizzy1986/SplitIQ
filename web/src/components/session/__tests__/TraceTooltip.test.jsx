import { render, screen } from '@testing-library/react';
import TraceTooltip from '../TraceTooltip.jsx';
import { wattsToPace500 } from '../../../utils/pace.js';

const rows = [
  { x: 0, watts: 150, hr: 120, rate: 20, speed: 4, pace: wattsToPace500(150) },
  {
    x: 65,
    watts: 200,
    hr: 150,
    rate: 26,
    speed: 4.5,
    pace: wattsToPace500(200),
  },
];
const has = { power: true, hr: true, rate: true, distance: true };

describe('TraceTooltip', () => {
  // Values and units are joined by a non-breaking space (units.js).
  it('shows every series at the hovered instant, whichever chart is hovered', () => {
    // Hovering the heart-rate chart: its payload names only hr, but the
    // tooltip reads the shared row and shows everything.
    render(
      <TraceTooltip
        active
        activeIndex="1"
        payload={[{ dataKey: 'hr', payload: rows[1] }]}
        rows={rows}
        sport="erg"
        has={has}
      />
    );
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText(/\/500 m$/)).toBeInTheDocument();
    expect(screen.getByText('200 W')).toBeInTheDocument();
    expect(screen.getByText('150 bpm')).toBeInTheDocument();
    expect(screen.getByText('26 spm')).toBeInTheDocument();
    expect(screen.getByText('Stroke rate')).toBeInTheDocument();
  });

  it('each chart shows its own series, so the three synced tooltips show each value once', () => {
    const shown = {};
    for (const chart of ['first', 'hr', 'rate']) {
      const { container, unmount } = render(
        <TraceTooltip
          active
          activeIndex="1"
          rows={rows}
          sport="erg"
          has={has}
          chart={chart}
        />
      );
      shown[chart] = container.textContent;
      // Every tooltip carries the time.
      expect(container.textContent).toContain('1:05');
      unmount();
    }
    expect(shown.first).toMatch(/Pace.*\/500\u00a0m.*Power200\u00a0W/);
    expect(shown.first).not.toMatch(/bpm|spm/);
    expect(shown.hr).toMatch(/Heart rate150\u00a0bpm/);
    expect(shown.hr).not.toMatch(/W|spm/);
    expect(shown.rate).toMatch(/Stroke rate26\u00a0spm/);
    expect(shown.rate).not.toMatch(/bpm|\/500/);
  });

  it('shows cycling speed whenever a speed channel exists, distance or not', () => {
    const noDistance = { ...has, distance: false };
    const { container } = render(
      <TraceTooltip
        active
        activeIndex={0}
        rows={rows}
        sport="cycling"
        has={noDistance}
        chart="first"
      />
    );
    expect(container.textContent).toContain('14.4\u00a0km/h');
    expect(container.textContent).toContain('150\u00a0W');
  });

  it('a ride with no power carries its speed on the heart-rate chart', () => {
    const noPower = { ...has, power: false };
    const { container } = render(
      <TraceTooltip
        active
        activeIndex={0}
        rows={rows}
        sport="cycling"
        has={noPower}
        chart="hr"
      />
    );
    expect(container.textContent).toContain('14.4\u00a0km/h');
    expect(container.textContent).toContain('120\u00a0bpm');
  });

  it('names cadence and speed on a ride', () => {
    render(
      <TraceTooltip
        active
        activeIndex={0}
        rows={rows}
        sport="cycling"
        has={has}
      />
    );
    expect(screen.getByText('Cadence')).toBeInTheDocument();
    expect(screen.getByText('20 rpm')).toBeInTheDocument();
    expect(screen.getByText('14.4 km/h')).toBeInTheDocument();
    expect(screen.queryByText(/\/500 m/)).toBeNull();
  });

  it('falls back to the payload row, says so over a gap, and hides when inactive', () => {
    const { rerender, container } = render(
      <TraceTooltip
        active
        payload={[{ payload: { x: 10, watts: null, hr: null, rate: null } }]}
        rows={[]}
        sport="erg"
        has={has}
      />
    );
    expect(screen.getByText('No reading at this moment')).toBeInTheDocument();
    rerender(<TraceTooltip active={false} rows={rows} sport="erg" has={has} />);
    expect(container).toBeEmptyDOMElement();
  });
});
