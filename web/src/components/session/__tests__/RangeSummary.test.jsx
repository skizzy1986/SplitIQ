import { fireEvent, render, screen } from '@testing-library/react';
import RangeSummary from '../RangeSummary.jsx';
import { NBSP } from '../units.js';

const item = (key) => document.querySelector(`[data-range="${key}"]`);
const value = (key) => item(key)?.querySelector('dd').textContent;

const stats = {
  elapsedS: 330,
  movingS: 300,
  distanceM: 1200,
  avgWatts: 201.4,
  avgHr: 151.2,
  avgRate: 24.4,
  pace500: 125,
  speedKmh: null,
};

describe('RangeSummary', () => {
  it('shows the selection’s duration, distance, power, pace, heart rate and rate', () => {
    render(<RangeSummary stats={stats} sport="erg" onClear={() => {}} />);
    expect(
      screen.getByRole('region', { name: 'Selected range' })
    ).toBeInTheDocument();
    expect(value('moving')).toBe('5:00');
    expect(value('elapsed')).toBe('5:30');
    expect(value('distance')).toBe(`1.20${NBSP}km`);
    expect(value('watts')).toBe(`201${NBSP}W`);
    expect(value('pace')).toBe(`2:05.0${NBSP}/500${NBSP}m`);
    expect(value('hr')).toBe(`151${NBSP}bpm`);
    expect(value('rate')).toBe(`24${NBSP}spm`);
    expect(screen.getByText('Average stroke rate')).toBeInTheDocument();
    expect(item('speed')).toBeNull();
  });

  it('a ride shows speed and cadence, not pace', () => {
    render(
      <RangeSummary
        stats={{ ...stats, pace500: null, speedKmh: 30.25, distanceM: 450 }}
        sport="cycling"
        onClear={() => {}}
      />
    );
    expect(value('speed')).toBe(`30.3${NBSP}km/h`);
    expect(value('distance')).toBe(`450${NBSP}m`);
    expect(value('rate')).toBe(`24${NBSP}rpm`);
    expect(screen.getByText('Average cadence')).toBeInTheDocument();
    expect(item('pace')).toBeNull();
  });

  it('leaves out an absent value, never showing a zero', () => {
    const { container } = render(
      <RangeSummary
        stats={{
          elapsedS: 60,
          movingS: 60,
          distanceM: null,
          avgWatts: null,
          avgHr: 0,
          avgRate: null,
          pace500: null,
          speedKmh: null,
        }}
        sport="erg"
        onClear={() => {}}
      />
    );
    const keys = [...container.querySelectorAll('[data-range]')].map(
      (el) => el.dataset.range
    );
    expect(keys).toEqual(['moving', 'elapsed']);
  });

  it('Clear returns to the whole session', () => {
    const onClear = vi.fn();
    render(<RangeSummary stats={stats} sport="erg" onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
