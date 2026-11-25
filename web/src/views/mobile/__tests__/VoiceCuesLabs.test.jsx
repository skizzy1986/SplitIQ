import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../supabaseClient.js', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}));
vi.mock('../../../components/StravaConnectPanel.jsx', () => ({
  default: () => <div data-testid="strava-panel" />,
}));
const unlockCueAudio = vi.hoisted(() => vi.fn());
const playLifecycle = vi.hoisted(() => vi.fn());
vi.mock('../../../services/cueAudio.js', () => ({ unlockCueAudio }));
vi.mock('../../../services/cueRuntime.js', () => ({ playLifecycle }));

import { i18n } from '@lingui/core';
import { messages as en } from '../../../locales/en.po';
import { messages as es } from '../../../locales/es.po';
import { messages as viewsEn } from '../../../locales/views/en.po';
import { messages as viewsEs } from '../../../locales/views/es.po';
import MobileSettings from '../MobileSettings.jsx';
import { readCueVoice, readCuesEnabled } from '../../../utils/cueSettings.js';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  i18n.activate('en');
});

describe('Settings › Labs › Voice cues (#785)', () => {
  it('is off by default, and turns on and off', async () => {
    const user = userEvent.setup();
    render(<MobileSettings onBack={() => {}} />);
    const box = screen.getByRole('checkbox', { name: /Voice cues \(beta\)/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(readCuesEnabled()).toBe(true);
    await user.click(box);
    expect(readCuesEnabled()).toBe(false);
  });

  it('chooses the voice and remembers it', async () => {
    const user = userEvent.setup();
    render(<MobileSettings onBack={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Dry' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Technical' }));
    expect(screen.getByRole('radio', { name: 'Technical' })).toBeChecked();
    expect(readCueVoice()).toBe('technical');
  });

  it('plays a test cue, unlocking the audio inside the tap', async () => {
    const user = userEvent.setup();
    playLifecycle.mockResolvedValue('started');
    window.localStorage.setItem('splitiq.cues.voice', 'encouraging');
    render(<MobileSettings onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Play a test cue' }));
    expect(unlockCueAudio).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(playLifecycle).toHaveBeenCalledWith('test', 'encouraging')
    );
    expect(
      await screen.findByText(/Did your music keep going/)
    ).toBeInTheDocument();
  });

  it('says so when the cue cannot play', async () => {
    const user = userEvent.setup();
    playLifecycle.mockResolvedValue('failed');
    render(<MobileSettings onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Play a test cue' }));
    expect(
      await screen.findByText(/Couldn.t play the cue/)
    ).toBeInTheDocument();
  });

  it('reads in Spanish, with the clips staying English', () => {
    i18n.load('es', { ...en, ...viewsEn, ...es, ...viewsEs });
    i18n.activate('es');
    render(<MobileSettings onBack={() => {}} />);
    expect(
      screen.getByRole('checkbox', { name: /Indicaciones de voz \(beta\)/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Reproducir una indicación de prueba',
      })
    ).toBeInTheDocument();
  });
});
