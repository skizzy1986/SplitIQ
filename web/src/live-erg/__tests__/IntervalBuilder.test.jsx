import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntervalBuilder } from '../IntervalBuilder.jsx';
import { createWorkout, MAX_INTERVALS } from '../intervalModel.js';

function fourHorsemen() {
  return createWorkout({
    type: 'int',
    name: 'Four Horsemen',
    ints: [
      { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
      { work: 1000, unit: 'm', rest: 120, watts: 185, rate: 22 },
      { work: 1000, unit: 'm', rest: 120, watts: 155, rate: 20 },
      { work: 1000, unit: 'm', rest: 0, watts: 125, rate: 18 },
    ],
  });
}

function Harness({ initial, termsMode }) {
  const [workout, setWorkout] = useState(initial);
  return (
    <IntervalBuilder
      workout={workout}
      onChange={setWorkout}
      termsMode={termsMode}
    />
  );
}

describe('IntervalBuilder', () => {
  it('lists each interval with its own set targets', () => {
    render(<Harness initial={fourHorsemen()} />);
    expect(screen.getByTestId('live-erg-interval-builder')).toBeInTheDocument();
    expect(screen.getByText('Interval 1 of 4')).toBeInTheDocument();
    expect(screen.getByText('Interval 4 of 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Interval 1 watts')).toHaveTextContent(
      '210 W'
    );
    expect(screen.getByLabelText('Interval 4 rate')).toHaveTextContent(
      '18 spm'
    );
    expect(screen.getAllByText(/phone only/i).length).toBe(4);
    expect(screen.getByText(/they don\u2019t repeat/i)).toBeInTheDocument();
    expect(
      screen.getByText(/The PM5 will show 4 intervals/i)
    ).toBeInTheDocument();
  });

  it('adds, removes and reorders through onChange', async () => {
    const user = userEvent.setup();
    render(<Harness initial={fourHorsemen()} />);

    await user.click(screen.getByRole('button', { name: '+ Add interval' }));
    expect(screen.getByText('Interval 5 of 5')).toBeInTheDocument();
    // Copying the last interval, which had 0 rest, gives the previous one 2:00.
    expect(screen.getByLabelText('Interval 4 rest')).toHaveTextContent('2:00');
    expect(screen.getByLabelText('Interval 5 rest')).toHaveTextContent('0:00');
    expect(screen.getByLabelText('Interval 5 watts')).toHaveTextContent(
      '125 W'
    );

    const downs = screen.getAllByRole('button', { name: 'Move interval down' });
    await user.click(downs[0]);
    expect(screen.getByLabelText('Interval 1 watts')).toHaveTextContent(
      '185 W'
    );
    expect(screen.getByLabelText('Interval 2 watts')).toHaveTextContent(
      '210 W'
    );

    const removes = screen.getAllByRole('button', { name: 'Remove interval' });
    await user.click(removes[0]);
    expect(screen.getByText('Interval 1 of 4')).toBeInTheDocument();
    expect(screen.queryByText('Interval 5 of 5')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Interval 1 watts')).toHaveTextContent(
      '210 W'
    );
  });

  it('switches unit and steps work, rest, watts and rate', async () => {
    const user = userEvent.setup();
    const initial = createWorkout({
      type: 'int',
      ints: [{ work: 1000, unit: 'm', rest: 120, watts: 200, rate: 22 }],
    });
    render(<Harness initial={initial} />);

    await user.click(screen.getByRole('button', { name: 'By time' }));
    expect(screen.getByLabelText('Interval 1 work')).toHaveTextContent('8:00');
    expect(screen.getByRole('button', { name: 'By time' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(
      screen.getByRole('button', { name: 'Interval 1 work, more' })
    );
    expect(screen.getByLabelText('Interval 1 work')).toHaveTextContent('8:30');

    await user.click(screen.getByRole('button', { name: 'By metres' }));
    expect(screen.getByLabelText('Interval 1 work')).toHaveTextContent(
      '1,000 m'
    );

    await user.click(
      screen.getByRole('button', { name: 'Interval 1 watts, less' })
    );
    expect(screen.getByLabelText('Interval 1 watts')).toHaveTextContent(
      '195 W'
    );
    await user.click(
      screen.getByRole('button', { name: 'Interval 1 rate, more' })
    );
    expect(screen.getByLabelText('Interval 1 rate')).toHaveTextContent(
      '23 spm'
    );
    await user.click(
      screen.getByRole('button', { name: 'Interval 1 rest, less' })
    );
    expect(screen.getByLabelText('Interval 1 rest')).toHaveTextContent('1:45');
  });

  it('shows CSAFE validation when a length is below the PM5 floor', () => {
    const initial = createWorkout({
      type: 'int',
      ints: [
        { work: 50, unit: 'm', rest: 120, watts: 200, rate: 22 },
        { work: 10, unit: 's', rest: 600, watts: 180, rate: 20 },
      ],
    });
    render(<Harness initial={initial} />);
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(
      screen.getByText('Interval 1: distance work starts at 100 m.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Interval 2: timed work must be 0:20 to 59:59.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Interval 2: rest maxes out at 9:55 on the PM5.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This would need 2 intervals/i)
    ).toBeInTheDocument();
  });

  it('disables remove on a single interval and add at the 50 cap', () => {
    const one = createWorkout({
      type: 'int',
      ints: [{ work: 1000, unit: 'm', rest: 0, watts: 200, rate: 22 }],
    });
    const { unmount } = render(<Harness initial={one} />);
    expect(
      screen.getByRole('button', { name: 'Remove interval' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move interval up' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move interval down' })
    ).toBeDisabled();
    unmount();

    const full = createWorkout({
      type: 'int',
      ints: Array.from({ length: MAX_INTERVALS }, () => ({
        work: 1000,
        unit: 'm',
        rest: 60,
        watts: 200,
        rate: 22,
      })),
    });
    render(<Harness initial={full} />);
    expect(
      screen.getByRole('button', { name: '+ Add interval' })
    ).toBeDisabled();
    expect(screen.getByText('Interval 50 of 50')).toBeInTheDocument();
  });

  it('keeps erg words and typographic punctuation, never paddle or rep', () => {
    render(<Harness initial={fourHorsemen()} termsMode="rowing" />);
    const root = screen.getByTestId('live-erg-interval-builder');
    expect(root.textContent).toMatch(/Interval/);
    expect(root.textContent).not.toMatch(/paddle/i);
    expect(root.textContent).not.toMatch(/\brep\b/i);
    expect(root.textContent).toContain('\u2019');
    expect(root.textContent).toContain('\u2014');
  });
});
