import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Settings > Password is a testers-build section (#792): there on a testers
// build, absent on the owner's.
const mocks = vi.hoisted(() => ({ testers: false }));
vi.mock('../../utils/testersBuild.js', () => ({
  isTestersBuild: () => mocks.testers,
}));
vi.mock('../../components/StravaConnectPanel.jsx', () => ({
  default: () => <div data-testid="strava-panel" />,
}));
vi.mock('../../components/ChangePasswordPanel.jsx', () => ({
  default: () => <div data-testid="password-panel" />,
}));

import SettingsView from '../SettingsView.jsx';

beforeEach(() => {
  mocks.testers = false;
});

describe('SettingsView password section', () => {
  it('is absent on the owner’s build', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Password')).toBeNull();
    expect(screen.queryByTestId('password-panel')).toBeNull();
  });

  it('shows, lazily, on a testers build', async () => {
    mocks.testers = true;
    render(<SettingsView />);
    expect(
      screen.getByRole('heading', { name: 'Password' })
    ).toBeInTheDocument();
    expect(await screen.findByTestId('password-panel')).toBeInTheDocument();
  });
});
