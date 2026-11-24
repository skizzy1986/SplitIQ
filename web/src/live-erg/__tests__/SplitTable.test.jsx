import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SplitTable } from '../SplitTable.jsx';
import { createWorkout, currentSplitFrom } from '../intervalModel.js';

function fourHorsemen() {
  return createWorkout({
    type: 'int',
    name: 'Four Horsemen',
    ints: [
      { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
      { work: 1000, unit: 'm', rest: 120, watts: 185, rate: 22 },
      { work: 480, unit: 's', rest: 90, watts: 155, rate: 20 },
      { work: 1000, unit: 'm', rest: 0, watts: 125, rate: 18 },
    ],
  });
}

const firstSplit = {
  n: 1,
  time: 210,
  m: 1000,
  pace: 105,
  w: 196,
  spm: 22,
  hr: 148,
  rest: 120,
};

describe('SplitTable', () => {
  it('puts planned distance in the metres column, not the time column', () => {
    render(
      <SplitTable
        workout={fourHorsemen()}
        splits={[]}
        phase="ready"
        units="watts"
      />
    );
    const table = screen.getByRole('table', { name: 'Split table' });
    const rows = within(table).getAllByRole('row');
    // header + 4 planned
    expect(rows).toHaveLength(5);
    const firstPlan = rows[1];
    expect(firstPlan).toHaveAttribute('data-kind', 'plan');
    const cells = within(firstPlan).getAllByRole('cell');
    // watts units: # Time Metres W /500m SPM HR ΔW
    expect(cells[0]).toHaveTextContent('1');
    expect(cells[1]).toHaveTextContent('\u00b7');
    expect(cells[2]).toHaveTextContent('1,000');
    expect(cells[3]).toHaveTextContent('\u00b7');
  });

  it('puts planned time in the time column for a timed interval', () => {
    render(
      <SplitTable
        workout={fourHorsemen()}
        splits={[]}
        phase="ready"
        units="watts"
      />
    );
    const rows = within(
      screen.getByRole('table', { name: 'Split table' })
    ).getAllByRole('row');
    const timed = rows[3];
    expect(timed).toHaveAttribute('data-kind', 'plan');
    const cells = within(timed).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('3');
    expect(cells[1]).toHaveTextContent('8:00');
    expect(cells[2]).toHaveTextContent('\u00b7');
  });

  it('marks the current split with an arrow and keeps planned rows below', () => {
    const current = currentSplitFrom({
      n: 1,
      splitTime: 95,
      metres: 430,
      spm: 24,
      hr: 140,
    });
    render(
      <SplitTable
        workout={fourHorsemen()}
        splits={[]}
        current={current}
        phase="work"
        units="watts"
      />
    );
    const rows = within(
      screen.getByRole('table', { name: 'Split table' })
    ).getAllByRole('row');
    // header, current, 3 remaining planned (4 planned minus the in-progress one)
    const now = rows.find((r) => r.getAttribute('data-kind') === 'now');
    expect(now).toBeTruthy();
    expect(now).toHaveTextContent('\u25b8');
    expect(now).toHaveTextContent(String(Math.round(current.w)));
    const planned = rows.filter((r) => r.getAttribute('data-kind') === 'plan');
    expect(planned).toHaveLength(3);
    expect(planned[0]).toHaveTextContent('2');
  });

  it('builds a sum row, ΔW from the previous split, and rest on a summary', () => {
    const splits = [
      firstSplit,
      {
        n: 2,
        time: 220,
        m: 1000,
        pace: 110,
        w: 188,
        spm: 22,
        hr: 150,
        rest: 90,
      },
    ];
    render(
      <SplitTable
        workout={fourHorsemen()}
        splits={splits}
        phase="rest"
        units="watts"
        summary
      />
    );
    const table = screen.getByRole('table', { name: 'Split table' });
    expect(
      within(table).getByRole('columnheader', { name: 'REST' })
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: '\u0394W' })
    ).not.toBeInTheDocument();
    const sum = table.querySelector('[data-kind="sum"]');
    expect(sum).toBeTruthy();
    expect(sum).toHaveTextContent('All');
    expect(sum).toHaveTextContent('7:10');
    expect(sum).toHaveTextContent('3:30');
    const splitRows = [...table.querySelectorAll('[data-kind="split"]')];
    expect(splitRows).toHaveLength(2);
    expect(splitRows[0]).toHaveTextContent('2:00');
    expect(splitRows[1]).toHaveTextContent('1:30');
  });

  it('orders watt columns first when units are watts, pace first otherwise', () => {
    const { rerender } = render(
      <SplitTable
        workout={fourHorsemen()}
        splits={[firstSplit]}
        phase="rest"
        units="watts"
      />
    );
    const headersOf = () =>
      within(screen.getByRole('table', { name: 'Split table' }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent);
    expect(headersOf().slice(0, 5)).toEqual([
      '#',
      'TIME',
      'METRES',
      'W',
      '/500m',
    ]);

    rerender(
      <SplitTable
        workout={fourHorsemen()}
        splits={[firstSplit]}
        phase="rest"
        units="pace"
      />
    );
    expect(headersOf().slice(0, 5)).toEqual([
      '#',
      'TIME',
      'METRES',
      '/500m',
      'W',
    ]);
  });

  it('carries band state as a word, not as the only signal', () => {
    const current = {
      n: 1,
      time: 95,
      m: 430,
      pace: 110,
      w: 191,
      spm: 24,
      hr: 140,
    };
    render(
      <SplitTable
        workout={fourHorsemen()}
        splits={[]}
        current={current}
        phase="work"
      />
    );
    const now = screen
      .getByRole('table', { name: 'Split table' })
      .querySelector('[data-kind="now"]');
    // 191 W vs 210 W target, BAND_W 5 → 14 W under, from the band edge.
    expect(now).toHaveAttribute('data-band', 'under');
    expect(now).toHaveTextContent('\u25b8');
    expect(now).toHaveTextContent('191');
  });
});
