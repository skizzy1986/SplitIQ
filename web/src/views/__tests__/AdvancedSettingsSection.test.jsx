import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const training = vi.hoisted(() => ({ settings: null }));
vi.mock('../../hooks/useTrainingSettings.js', () => ({
  useTrainingSettings: () => training.settings,
}));

const db = vi.hoisted(() => ({
  live: null,
  history: [],
  anchorsGate: null,
  rpc: null,
  writes: 0,
}));
vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        // useAnchors: .select(...).is('superseded_at', null)
        is: () =>
          (db.anchorsGate ?? Promise.resolve()).then(() => ({
            data: db.live ? [db.live] : [],
            error: null,
          })),
        // useAnchorHistory: .select(...).eq(...).order(...).order(...)
        eq: () => chain,
        order: () => ({
          order: () => Promise.resolve({ data: db.history, error: null }),
        }),
        insert: () => {
          db.writes += 1;
        },
        update: () => {
          db.writes += 1;
        },
        delete: () => {
          db.writes += 1;
        },
      };
      return chain;
    },
    rpc: (...args) => db.rpc(...args),
  },
}));

import AdvancedSettingsSection from '../AdvancedSettingsSection.jsx';

const LIVE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'rowing_cp',
  value: '215',
  unit: 'W',
  status: 'unvalidated',
  source: 'manual',
  valid_from: '2026-11-20',
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <AdvancedSettingsSection />
    </QueryClientProvider>
  );
  return { invalidate };
}

beforeEach(() => {
  training.settings = {
    loaded: true,
    available: true,
    depth: 'expert',
  };
  db.live = LIVE;
  db.history = [{ ...LIVE, superseded_at: null, reason: 'manual' }];
  db.anchorsGate = null;
  db.writes = 0;
  db.rpc = vi.fn().mockResolvedValue({
    data: { status: 'saved', id: 'new', replaced: true },
    error: null,
  });
});

describe('Settings > Advanced (#819 S4)', () => {
  it('H5: nothing about CP at simple depth', () => {
    training.settings = { loaded: true, available: true, depth: 'simple' };
    const { container } = render(<AdvancedSettingsSection />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/CP/)).toBeNull();
  });

  it('renders nothing where the settings table is absent (production) or still loading', () => {
    training.settings = { loaded: true, available: false, depth: 'simple' };
    const first = render(<AdvancedSettingsSection />);
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    training.settings = { loaded: false, available: false, depth: 'simple' };
    const second = render(<AdvancedSettingsSection />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it('H38: at expert depth the form seeds from the saved CP only after the read answers', async () => {
    let release;
    db.anchorsGate = new Promise((r) => {
      release = r;
    });
    renderSection();
    expect(
      screen.getByRole('heading', { name: 'Advanced' })
    ).toBeInTheDocument();
    // Before the anchors read answers there is no field to start blank.
    expect(screen.queryByLabelText('Rowing CP (watts)')).toBeNull();
    release();
    expect(await screen.findByLabelText('Rowing CP (watts)')).toHaveValue(215);
    expect(await screen.findByText('Typed in')).toBeInTheDocument();
  });

  it('A32/H38: a save names the live row it replaces, refetches, and never writes anchors directly', async () => {
    const { invalidate } = renderSection();
    const input = await screen.findByLabelText('Rowing CP (watts)');
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rowing CP saved.'
    );
    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = db.rpc.mock.calls[0];
    expect(fn).toBe('save_my_cp');
    expect(args).toMatchObject({
      p_watts: 230,
      p_source: 'manual',
      p_status: 'unvalidated',
      p_reason: 'manual',
      p_expected_live_id: LIVE.id,
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['anchors'] })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['anchorHistory', 'rowing_cp'],
    });
    expect(db.writes).toBe(0);
  });

  it('a failed save refetches nothing', async () => {
    db.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'x' },
    });
    const { invalidate } = renderSection();
    const input = await screen.findByLabelText('Rowing CP (watts)');
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save that. Try again.'
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});
