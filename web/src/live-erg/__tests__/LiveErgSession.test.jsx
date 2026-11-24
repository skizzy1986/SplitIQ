import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveErgSession from '../LiveErgSession.jsx';
import { loadLiveErgSession } from '../loadLiveErgSession.js';

describe('LiveErgSession skeleton', () => {
  it('renders the live session shell', () => {
    render(<LiveErgSession />);
    expect(screen.getByTestId('live-erg-session')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Live session' })
    ).toBeInTheDocument();
  });

  it('loads through the lazy seam', async () => {
    const mod = await loadLiveErgSession();
    expect(mod.default).toBe(LiveErgSession);
  });
});
