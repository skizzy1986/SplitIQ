import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

const panelMock = vi.fn();
const training = vi.hoisted(() => ({
  settings: null,
  mutateAsync: vi.fn(),
}));

vi.mock('../../hooks/useTrainingSettings.js', () => ({
  useTrainingSettings: () => training.settings,
  useUpdateTrainingSettings: () => ({
    mutateAsync: training.mutateAsync,
    isPending: false,
  }),
}));

// Settings > Advanced reads anchors only at expert depth; these accounts are
// simple depth, so the client is never called.
vi.mock('../../supabaseClient.js', () => ({ supabase: {} }));

vi.mock('../../components/StravaConnectPanel.jsx', () => ({
  default: (props) => {
    panelMock(props);
    return <div data-testid="strava-panel" />;
  },
}));

import SettingsView from '../SettingsView.jsx';

beforeEach(() => {
  panelMock.mockReset();
  training.mutateAsync.mockReset();
  training.mutateAsync.mockResolvedValue();
  training.settings = {
    loaded: true,
    available: true,
    hasRow: true,
    hrPath: 'rpe',
    birthYear: null,
  };
});

describe('SettingsView', () => {
  it('renders the Strava panel under an Integrations heading', () => {
    render(<SettingsView />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByTestId('strava-panel')).toBeInTheDocument();
  });

  it('threads onSynced through to the panel', () => {
    const onSynced = vi.fn();
    render(<SettingsView onSynced={onSynced} />);
    expect(panelMock).toHaveBeenCalledWith(
      expect.objectContaining({ onSynced })
    );
  });

  it('surfaces the OAuth callback notice when one is passed', () => {
    render(
      <SettingsView notice={{ tone: 'positive', text: 'Strava connected.' }} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Strava connected.');
  });

  it('falls back to neutral colours for an unrecognised notice tone', () => {
    render(<SettingsView notice={{ tone: 'nonsense', text: 'Hmm.' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Hmm.');
  });

  it('renders no notice region when there is nothing to say', () => {
    render(<SettingsView />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the baked-in build identifier under About', () => {
    render(<SettingsView />);
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
    const line = screen.getByLabelText('Build dev');
    expect(line).toHaveTextContent('Build dev');
  });
  it('H9: the path changes in one step from Settings', async () => {
    render(<SettingsView />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Training' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "I don't have one" })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('You are on the no-strap path. You rate effort by feel.')
    ).toBeInTheDocument();
    // One tap, no confirm step, one write.
    fireEvent.click(
      screen.getByRole('button', { name: 'I have a strap or arm band' })
    );
    await waitFor(() => expect(training.mutateAsync).toHaveBeenCalledTimes(1));
    expect(training.mutateAsync).toHaveBeenCalledWith({
      hr_path: 'strap',
      hr_path_chosen_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    // Settings has no Skip: the choice is already made.
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });

  it('says nothing is chosen when the account has not chosen, and selects neither', () => {
    training.settings = { ...training.settings, hrPath: null };
    render(<SettingsView />);
    expect(screen.getByText('You have not chosen yet.')).toBeInTheDocument();
    const section = within(screen.getByRole('region', { name: 'Training' }));
    expect(section.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('says so when the path cannot be saved', async () => {
    training.mutateAsync.mockRejectedValue(new Error('denied'));
    render(<SettingsView />);
    fireEvent.click(
      screen.getByRole('button', { name: 'I have a strap or arm band' })
    );
    expect(
      await screen.findByText('Could not save that. Try again.')
    ).toBeInTheDocument();
  });

  it('saves and removes the year of birth from Settings', async () => {
    training.settings = { ...training.settings, birthYear: 1985 };
    render(<SettingsView />);
    expect(screen.getByRole('textbox', { name: 'Year of birth' })).toHaveValue(
      '1985'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(training.mutateAsync).toHaveBeenCalledWith({ birth_year: null })
    );
  });

  it('shows no Training section until the settings table is there to read', () => {
    for (const settings of [
      { loaded: false, available: false },
      { loaded: true, available: false },
    ]) {
      training.settings = {
        hasRow: false,
        hrPath: null,
        birthYear: null,
        ...settings,
      };
      const { unmount } = render(<SettingsView />);
      expect(screen.queryByRole('heading', { name: 'Training' })).toBeNull();
      unmount();
    }
  });
});
