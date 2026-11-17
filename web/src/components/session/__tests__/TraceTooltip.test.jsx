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
