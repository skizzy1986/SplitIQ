import { fireEvent, render, screen, within } from '@testing-library/react';
import SplitsTable from '../SplitsTable.jsx';
import { NBSP } from '../units.js';
import { distanceSplits, lapSplits } from '../../../utils/sessionSeries.js';
import { createSeries } from '../../../utils/sessionSeries.js';

// Synthetic: 4 m/s for 299 s at 200 W, 140 bpm, 24 spm.
const row = createSeries({
  source: 'test',
  t: Array.from({ length: 300 }, (_, i) => i),
  channels: {
    watts: Array(300).fill(200),
    hr: Array(300).fill(140),
    rate: Array(300).fill(24),
    dist: Array.from({ length: 300 }, (_, i) => i * 4),
  },
});

const rowing = (props = {}) =>
  render(
    <SplitsTable
      splits={distanceSplits(row, 'erg', 500)}
      sport="erg"
      mode="distance"
      splitM={500}
      splitOptions={[500, 1000, 2000]}
      onSplitM={() => {}}
      selectedIndex={null}
      onSelect={() => {}}
      {...props}
    />
  );

describe('SplitsTable', () => {
  it('is a real table with column and row headers', () => {
    rowing();
    const table = screen.getByRole('table', {
      name: `One row every 500${NBSP}m.`,
    });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Split',
      'Time',
      'Distance',
      'Power',
      'Pace',
      'Heart rate',
      'Stroke rate',
    ]);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
    const first = within(table).getAllByRole('row')[1];
    expect(
      within(first)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual([
      '2:05',
      `500${NBSP}m`,
      `200${NBSP}W`,
      `2:05.0 /500${NBSP}m`,
      `140${NBSP}bpm`,
      `24${NBSP}spm`,
    ]);
  });

  it('marks the partial last split in words', () => {
    rowing();
    expect(
      screen.getByRole('button', { name: '3 (partial)' })
    ).toBeInTheDocument();
  });

  it('selects with a pressed toggle per row; pressing the selected one clears', () => {
    const onSelect = vi.fn();
    const { rerender } = rowing({ onSelect });
    const one = screen.getByRole('button', { name: '1' });
    expect(one).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(one);
    expect(onSelect).toHaveBeenLastCalledWith(0);
    rerender(
      <SplitsTable
        splits={distanceSplits(row, 'erg', 500)}
        sport="erg"
        mode="distance"
        splitM={500}
        splitOptions={[500, 1000, 2000]}
        onSplitM={() => {}}
        selectedIndex={0}
        onSelect={onSelect}
      />
    );
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('offers the rowing split distance', () => {
    const onSplitM = vi.fn();
    rowing({ onSplitM });
    const control = screen.getByRole('navigation', { name: 'Split distance' });
    expect(
      within(control)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual([`500${NBSP}m`, `1.00${NBSP}km`, `2.00${NBSP}km`]);
    fireEvent.click(within(control).getByRole('button', { name: /^1\.00/ }));
    expect(onSplitM).toHaveBeenCalledWith(1000);
  });

  it('a ride by lap: speed and cadence, no split distance control', () => {
    const ride = createSeries({
      source: 'test',
      t: Array.from({ length: 11 }, (_, i) => i * 10),
      channels: {
        watts: Array(11).fill(250),
        rate: Array(11).fill(90),
        dist: Array.from({ length: 11 }, (_, i) => i * 80),
      },
      laps: [
        { i0: 0, i1: 4 },
        { i0: 4, i1: 10 },
      ],
    });
    render(
      <SplitsTable
        splits={lapSplits(ride, 'cycling')}
        sport="cycling"
        mode="laps"
        selectedIndex={null}
        onSelect={() => {}}
      />
    );
    expect(
      screen.getByRole('table', { name: 'One row per recorded lap.' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent)
    ).toEqual(['Lap', 'Time', 'Distance', 'Power', 'Speed', 'Cadence']);
    expect(screen.queryByRole('navigation')).toBeNull();
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells.filter((c) => c === `28.8${NBSP}km/h`)).toHaveLength(2);
  });

  it('leaves out a column no split has, and dashes a missing value', () => {
    const splits = distanceSplits(row, 'erg', 500).map((s, i) => ({
      ...s,
      avgHr: null,
      avgRate: i === 0 ? null : s.avgRate,
    }));
    rowing({ splits });
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).not.toContain('Heart rate');
    const first = screen.getAllByRole('row')[1];
    expect(within(first).getAllByRole('cell').at(-1).textContent).toBe('–');
  });
});
