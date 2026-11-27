import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../TrainingSettingsSection.jsx', () => ({ default: () => null }));
vi.mock('../../../supabaseClient.js', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock('../../../components/StravaConnectPanel.jsx', () => ({
  default: () => <div data-testid="strava-panel" />,
}));

import { i18n } from '@lingui/core';
import { messages as en } from '../../../locales/en.po';
import { messages as es } from '../../../locales/es.po';
import { messages as viewsEn } from '../../../locales/views/en.po';
import { messages as viewsEs } from '../../../locales/views/es.po';
import MobileSettings from '../MobileSettings.jsx';
import {
  LIVE_ERG_FLAG_KEY,
  readLiveErgFlag,
} from '../../../live-erg/liveErgFlag.js';

beforeEach(() => window.localStorage.removeItem(LIVE_ERG_FLAG_KEY));
afterEach(() => {
  window.localStorage.removeItem(LIVE_ERG_FLAG_KEY);
  i18n.activate('en');
});

describe('Settings › Labs (#768)', () => {
  it('offers the v10 live screen off by default and turns it on and off', async () => {
    const user = userEvent.setup();
    render(<MobileSettings onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Labs' })).toBeInTheDocument();
    const box = screen.getByRole('checkbox', {
      name: /New live screen \(beta\)/,
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(readLiveErgFlag()).toBe(true);
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(readLiveErgFlag()).toBe(false);
  });

  it('shows an opt-in made earlier', () => {
    window.localStorage.setItem(LIVE_ERG_FLAG_KEY, 'v10');
    render(<MobileSettings onBack={() => {}} />);
    expect(
      screen.getByRole('checkbox', { name: /New live screen/ })
    ).toBeChecked();
  });

  it('reads in Spanish', () => {
    i18n.load('es', { ...en, ...viewsEn, ...es, ...viewsEs });
    i18n.activate('es');
    render(<MobileSettings onBack={() => {}} />);
    expect(
      screen.getByRole('heading', { name: 'Funciones en prueba' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Nueva pantalla en vivo/ })
    ).toBeInTheDocument();
  });
});
