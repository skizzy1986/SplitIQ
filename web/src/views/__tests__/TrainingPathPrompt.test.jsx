import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
  settings: null,
  mutateAsync: vi.fn(),
  testers: false,
}));

vi.mock('../../hooks/useTrainingSettings.js', () => ({
  useTrainingSettings: () => mocks.settings,
  useUpdateTrainingSettings: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));
vi.mock('../../utils/testersBuild.js', () => ({
  isTestersBuild: () => mocks.testers,
}));

import TrainingPathPrompt from '../TrainingPathPrompt.jsx';
import {
  dismissGuide,
  guideStorageKey,
  requestGuideOpen,
} from '../../utils/firstRunGuide.js';

const fresh = { loaded: true, available: true, hasRow: false };

beforeEach(() => {
  window.localStorage.clear();
  mocks.settings = fresh;
  mocks.testers = false;
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue();
});

describe('TrainingPathPrompt', () => {
  it('shows the one screen to an account with no settings row, with nothing selected', () => {
    render(<TrainingPathPrompt userId="user-a" />);
    expect(
      screen.getByRole('dialog', { name: 'Do you have a heart-rate strap?' })
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('H7: skipping stores the rpe path with today as the date', async () => {
    render(<TrainingPathPrompt userId="user-a" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Skip, and go by effort' })
    );
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      hr_path: 'rpe',
      hr_path_chosen_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('H6: choosing a strap stores strap; choosing none stores rpe', async () => {
    render(<TrainingPathPrompt userId="user-a" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'I have a strap or arm band' })
    );
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ hr_path: 'strap' })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ hr_path: 'rpe' })
      )
    );
  });

  it('says so, and stays, when the save fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('denied'));
    render(<TrainingPathPrompt userId="user-a" />);
    fireEvent.click(screen.getByRole('button', { name: "I don't have one" }));
    expect(
      await screen.findByText('Could not save that. Try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    [
      'an account that already has a row (chosen, skipped or backfilled)',
      { ...fresh, hasRow: true },
    ],
    [
      'a project without the settings table',
      { loaded: true, available: false, hasRow: false },
    ],
    [
      'a read still loading',
      { loaded: false, available: false, hasRow: false },
    ],
  ])('shows nothing for %s', (_label, settings) => {
    mocks.settings = settings;
    render(<TrainingPathPrompt userId="user-a" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing without a signed-in user', () => {
    render(<TrainingPathPrompt userId={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits for the first-run guide on a testers build, then follows it', async () => {
    mocks.testers = true;
    render(<TrainingPathPrompt userId="user-a" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => dismissGuide('user-a'));
    expect(
      await screen.findByRole('dialog', {
        name: 'Do you have a heart-rate strap?',
      })
    ).toBeInTheDocument();
    // Reopening the guide from Settings puts the guide first again.
    act(() => requestGuideOpen('user-a'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(guideStorageKey('user-a'))).toBeNull();
  });

  it('does not wait on a build with no guide', () => {
    mocks.testers = false;
    render(<TrainingPathPrompt userId="user-a" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
