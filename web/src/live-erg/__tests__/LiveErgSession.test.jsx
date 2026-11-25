import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () =>
          Promise.resolve({
            data: [{ key: 'rowing_cp', value: '240' }],
            error: null,
          }),
      }),
    }),
  },
}));

import LiveErgSession, { LiveErgSessionView } from '../LiveErgSession.jsx';
import { loadLiveErgSession } from '../loadLiveErgSession.js';

function memory() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const plan = {
  type: 'int',
  ints: [
    { work: 1000, unit: 'm', rest: 120, watts: 210, rate: 24 },
    { work: 1000, unit: 'm', rest: 0, watts: 185, rate: 22 },
  ],
  reps: 2,
};

function sample(elapsedTime, distance, workoutState, watts = 191) {
  return {
    elapsedTime,
    distance,
    workoutState,
    rowingState: 1,
    strokeRate: 23,
    pace500: 12000,
    watts,
  };
}

describe('LiveErgSession', () => {
  it('shows the builder before the first stroke, with the placeholder note', () => {
    render(<LiveErgSessionView storage={memory()} />);
    expect(screen.getByTestId('live-erg-session')).toHaveAttribute(
      'data-phase',
      'ready'
    );
    expect(
      screen.getByRole('heading', { name: 'Live session' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('live-erg-interval-builder')).toBeInTheDocument();
    expect(
      screen.getByText(/200 W critical power placeholder/)
    ).toBeInTheDocument();
  });

  it('follows PM5 samples into work, with band word and arrow, then rest', () => {
    const store = memory();
    store.setItem('splitiq.liveErg.workout', JSON.stringify(plan));
    const { rerender } = render(
      <LiveErgSessionView
        storage={store}
        status="rowing"
        metrics={sample(0, 0, 5)}
      />
    );
    rerender(
      <LiveErgSessionView
        storage={store}
        status="rowing"
        metrics={sample(90, 430, 5)}
      />
    );
    expect(screen.getByTestId('live-erg-session')).toHaveAttribute(
      'data-phase',
      'work'
    );
    const band = screen.getByTestId('live-erg-band');
    // 191 W against 210 W: 14 W under the band edge, as in v10.
    expect(band).toHaveAttribute('data-band', 'under');
    expect(band).toHaveTextContent('\u25bc 14 W under 210 W');
    expect(screen.getByText(/phone only/)).toBeInTheDocument();
    expect(screen.getByTestId('live-erg-split-table')).toBeInTheDocument();

    rerender(
      <LiveErgSessionView
        storage={store}
        status="connected"
        metrics={sample(91, 430, 3)}
      />
    );
    expect(screen.getByTestId('live-erg-session')).toHaveAttribute(
      'data-phase',
      'rest'
    );
    expect(
      screen.getByText(/next: Interval 2 · 185 W · 22 spm/)
    ).toBeInTheDocument();
  });

  it('hands End back to ErgLiveView', async () => {
    const onEnd = vi.fn();
    render(
      <LiveErgSessionView storage={memory()} status="connected" onEnd={onEnd} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'End piece' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('saves builder edits so a reconnect keeps the plan', async () => {
    const store = memory();
    render(<LiveErgSessionView storage={store} status="connected" />);
    await userEvent.click(
      screen.getByRole('button', { name: '+ Add interval' })
    );
    expect(
      JSON.parse(store.getItem('splitiq.liveErg.workout')).ints
    ).toHaveLength(5);
  });

  it('reads CP from the anchors and loads through the lazy seam', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LiveErgSession storage={memory()} />
      </QueryClientProvider>
    );
    expect(
      await screen.findByRole('heading', { name: 'Live session' })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/placeholder/)).not.toBeInTheDocument()
    );
    const mod = await loadLiveErgSession();
    expect(mod.default).toBe(LiveErgSession);
  });
});
