import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../i18n/views.js';

vi.mock('../../supabaseClient.js', () => ({ supabase: {} }));

import { LiveErgPlannerView, LiveErgSessionView } from '../LiveErgSession.jsx';
import { LIVE_ERG_WORKOUT_KEY, readSavedWorkout } from '../liveErgFlag.js';
import { intervalsOf } from '../intervalModel.js';

function memory() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe('LiveErgPlannerView', () => {
  it('opens the interval builder with no PM5 and nothing saved', () => {
    render(<LiveErgPlannerView storage={memory()} />);
    expect(screen.getByTestId('live-erg-planner')).toBeInTheDocument();
    expect(screen.getByTestId('live-erg-interval-builder')).toBeInTheDocument();
    expect(screen.getByText(/No PM5 needed/)).toBeInTheDocument();
    expect(screen.getByText(/200 W critical power placeholder/)).toBeVisible();
  });

  it('saves every change, and the live screen opens with that plan', async () => {
    const user = userEvent.setup();
    const storage = memory();
    const { unmount } = render(<LiveErgPlannerView storage={storage} />);
    const before = intervalsOf(
      JSON.parse(storage.getItem(LIVE_ERG_WORKOUT_KEY) ?? 'null') ?? {}
    );
    expect(before).toHaveLength(0);

    await user.click(
      screen.getAllByRole('button', { name: 'Remove interval' })[0]
    );
    const saved = readSavedWorkout(storage);
    expect(intervalsOf(saved)).toHaveLength(3);
    unmount();

    // At the gym: the live screen reads the same key.
    render(<LiveErgSessionView storage={storage} />);
    expect(screen.getByText(/Your saved plan is loaded/)).toBeVisible();
    expect(
      screen.getAllByRole('region', { name: /interval \d of 3/i })
    ).toHaveLength(3);
  });

  it('the live screen says build, not loaded, when no plan was saved', () => {
    render(<LiveErgSessionView storage={memory()} />);
    expect(screen.queryByText(/Your saved plan is loaded/)).toBeNull();
    expect(screen.getByText(/Build your intervals here/)).toBeVisible();
  });

  it('reopening the planner shows the plan that was saved', () => {
    const storage = memory();
    const { unmount } = render(<LiveErgPlannerView storage={storage} />);
    unmount();
    const first = render(<LiveErgPlannerView storage={storage} />);
    first.unmount();
    // Nothing was changed, so nothing was written: still the default four.
    expect(storage.getItem(LIVE_ERG_WORKOUT_KEY)).toBeNull();
    render(<LiveErgPlannerView storage={storage} />);
    expect(
      screen.getAllByRole('region', { name: /interval \d of 4/i })
    ).toHaveLength(4);
  });

  it('Start on PM5 saves the in-memory plan even when it was not edited', async () => {
    const user = userEvent.setup();
    const storage = memory();
    const onStart = vi.fn();
    const { unmount } = render(
      <LiveErgPlannerView storage={storage} onStart={onStart} />
    );
    expect(storage.getItem(LIVE_ERG_WORKOUT_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start on PM5' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const saved = readSavedWorkout(storage);
    expect(intervalsOf(saved)).toHaveLength(4);
    unmount();

    render(<LiveErgSessionView storage={storage} />);
    expect(screen.getByText(/Your saved plan is loaded/)).toBeVisible();
    expect(
      screen.getAllByRole('region', { name: /interval \d of 4/i })
    ).toHaveLength(4);
  });

  it('Start on PM5 is absent without a handler, and disabled when the plan is invalid', () => {
    const { rerender } = render(
      <LiveErgPlannerView storage={memory()} onStart={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'Start on PM5' })).toBeEnabled();
    rerender(<LiveErgPlannerView storage={memory()} />);
    expect(screen.queryByRole('button', { name: 'Start on PM5' })).toBeNull();

    const storage = memory();
    storage.setItem(
      LIVE_ERG_WORKOUT_KEY,
      JSON.stringify({
        type: 'int',
        ints: [{ work: 50, unit: 'm', rest: 0, watts: 125, rate: 22 }],
      })
    );
    render(<LiveErgPlannerView storage={storage} onStart={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start on PM5' })).toBeDisabled();
  });

  it('the live screen says build, not loaded, for a bare or non-interval save', () => {
    const storage = memory();
    storage.setItem(LIVE_ERG_WORKOUT_KEY, JSON.stringify({ type: 'int' }));
    render(<LiveErgSessionView storage={storage} />);
    expect(screen.queryByText(/Your saved plan is loaded/)).toBeNull();
    expect(screen.getByText(/Build your intervals here/)).toBeVisible();
  });
});
