import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const panelMock = vi.fn();

vi.mock('../../components/StravaConnectPanel.jsx', () => ({
  default: (props) => {
    panelMock(props);
    return <div data-testid="strava-panel" />;
  },
}));

vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import SettingsView from '../SettingsView.jsx';

beforeEach(() => {
  panelMock.mockReset();
});

function renderSettings(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

describe('SettingsView', () => {
  it('renders the Strava panel under an Integrations heading', () => {
    renderSettings(<SettingsView />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByTestId('strava-panel')).toBeInTheDocument();
  });

  it('threads onSynced through to the panel', () => {
    const onSynced = vi.fn();
    renderSettings(<SettingsView onSynced={onSynced} />);
    expect(panelMock).toHaveBeenCalledWith(
      expect.objectContaining({ onSynced })
    );
  });

  it('surfaces the OAuth callback notice when one is passed', () => {
    renderSettings(
      <SettingsView notice={{ tone: 'positive', text: 'Strava connected.' }} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Strava connected.');
  });

  it('falls back to neutral colours for an unrecognised notice tone', () => {
    renderSettings(
      <SettingsView notice={{ tone: 'nonsense', text: 'Hmm.' }} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Hmm.');
  });

  it('renders no notice region when there is nothing to say', () => {
    renderSettings(<SettingsView />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers Report a problem under Help', () => {
    renderSettings(<SettingsView />);
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Report a problem' })
    ).toBeInTheDocument();
  });
});
