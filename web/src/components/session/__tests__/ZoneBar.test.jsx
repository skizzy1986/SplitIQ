import { render, screen } from '@testing-library/react';
import ZoneBar from '../ZoneBar.jsx';
import { createSeries } from '../../../utils/sessionSeries.js';
import { timeInZones } from '../../../utils/sessionAnalysis.js';
import {
  deriveCyclingZones,
  derivePaceZones,
} from '../../../constants/trainingConfig.js';
import { spacedText } from '../../../test/spacedText.js';

const series = (watts) =>
  createSeries({
    source: 'test',
    t: watts.map((_, i) => i * 60),
    channels: { watts },
  });

describe('ZoneBar', () => {
  it('shows time per zone and the rowing anchor with its status', () => {
    const result = timeInZones(
      createSeries({
        source: 'test',
        // 601 samples: 600 one-second intervals.
        t: Array.from({ length: 601 }, (_, i) => i),
        channels: {
          watts: Array.from({ length: 601 }, (_, i) => (i < 450 ? 120 : 150)),
        },
      }),
      derivePaceZones(200)
    );
    render(
      <ZoneBar
        result={result}
        anchor={{ kind: 'cp', value: 200, status: 'confirmed' }}
        hasPower
      />
    );
    expect(
      screen.getByText('Zones from your rowing CP, 200 W (confirmed).')
    ).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Time in zone: UT2 8 min, UT1 3 min.'
    );
    expect(screen.getByText('UT2').closest('li')).toHaveTextContent(
      'UT2 8 min · 75%'
    );
  });

  it("names the cycling level and Coggan's zone id", () => {
    const result = timeInZones(
      series([100, 100, 160]),
      deriveCyclingZones(200)
    );
    render(
      <ZoneBar
        result={result}
        anchor={{ kind: 'ftp', value: 200, status: 'provisional' }}
        hasPower
      />
    );
    expect(screen.getByText('Z1 Active recovery')).toBeInTheDocument();
    expect(screen.getByText('Z7 Neuromuscular power')).toBeInTheDocument();
    expect(
      screen.getByText('Zones from your bike FTP, 200 W (provisional).')
    ).toBeInTheDocument();
  });

  it('names an unvalidated anchor as such', () => {
    const result = timeInZones(series([150, 150, 150]), derivePaceZones(200));
    render(
      <ZoneBar
        result={result}
        anchor={{ kind: 'cp', value: 200, status: 'unvalidated' }}
        hasPower
      />
    );
    expect(
      screen.getByText('Zones from your rowing CP, 200 W (unvalidated).')
    ).toBeInTheDocument();
  });

  it("H3: no 'CP unavailable', 'anchor unreachable' or 'cannot be read' without a CP", () => {
    render(
      <ZoneBar
        result={null}
        anchor={{ kind: 'cp', value: null, status: null }}
        hasPower
      />
    );
    // Plain words that say what comes next, with no CP and no fault wording.
    const note = screen.getByText(
      'No zones are drawn yet. They appear once a rowing test has set your power zones.'
    );
    expect(note).toBeInTheDocument();
    expect(spacedText(note)).not.toMatch(
      /\bCP\b|critical power|anchor|unavailable|unreachable|cannot be read/i
    );
    expect(screen.queryByRole('img')).toBeNull();
    render(<ZoneBar result={null} anchor={{ kind: 'ftp' }} hasPower />);
    expect(screen.getByText(/bike FTP anchor/)).toBeInTheDocument();
  });

  it('with no power says so and draws no bar', () => {
    render(<ZoneBar result={null} anchor={null} hasPower={false} />);
    expect(
      screen.getByText('This session has no power reading, so no time in zone.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reports moving time without power', () => {
    const result = timeInZones(
      createSeries({
        source: 'test',
        t: Array.from({ length: 200 }, (_, i) => i),
        channels: {
          watts: Array.from({ length: 200 }, (_, i) => (i < 100 ? 150 : null)),
        },
      }),
      derivePaceZones(200)
    );
    render(
      <ZoneBar
        result={result}
        anchor={{ kind: 'cp', value: 200, status: null }}
        hasPower
      />
    );
    expect(
      screen.getByText(
        '2 min of moving time had no power reading and is not in any zone.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Zones from your rowing CP, 200 W.')
    ).toBeInTheDocument();
  });
});
