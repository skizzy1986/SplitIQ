import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../../i18n/views.js';

vi.mock('../../ErgLiveView.jsx', () => ({
  default: () => <p>ERG LIVE</p>,
}));
vi.mock('../../../StrengthLogger.jsx', () => ({
  default: () => <p>STRENGTH LOGGER</p>,
}));
vi.mock('../../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useAnchors.js', () => ({
  useAnchors: () => ({ cp: 240 }),
}));

import MobileTrain from '../MobileTrain.jsx';
import {
  LIVE_ERG_FLAG_KEY,
  LIVE_ERG_FLAG_ON,
  LIVE_ERG_WORKOUT_KEY,
} from '../../../live-erg/liveErgFlag.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('Train: plan before connecting (#774)', () => {
  it('has no Plan a session entry while the v10 live screen is off', () => {
    render(<MobileTrain mode={null} onMode={() => {}} />);
    expect(screen.getByRole('button', { name: /Erg session/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Plan a session/ })).toBeNull();
  });

  it('offers it once the live screen is on, next to Erg, and it opens the planner', async () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, LIVE_ERG_FLAG_ON);
    const user = userEvent.setup();
    const onMode = vi.fn();
    render(<MobileTrain mode={null} onMode={onMode} />);
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => /session/i.test(t));
    expect(labels[0]).toMatch(/Erg session/);
    expect(labels[1]).toMatch(/Plan a session/);
    expect(labels[2]).toMatch(/Strength session/);
    await user.click(screen.getByRole('button', { name: /Plan a session/ }));
    expect(onMode).toHaveBeenCalledWith('plan');
  });

  it('plan mode shows the builder with no PM5, saves, and Start goes to the erg flow', async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    render(<MobileTrain mode="plan" onMode={onMode} />);
    expect(await screen.findByTestId('live-erg-planner')).toBeVisible();
    expect(screen.queryByText('ERG LIVE')).toBeNull();

    await user.click(
      screen.getAllByRole('button', { name: 'Remove interval' })[0]
    );
    expect(
      JSON.parse(window.localStorage.getItem(LIVE_ERG_WORKOUT_KEY))
    ).toMatchObject({
      type: 'int',
    });

    await user.click(screen.getByRole('button', { name: 'Start on PM5' }));
    expect(onMode).toHaveBeenCalledWith('erg');
  });
});
