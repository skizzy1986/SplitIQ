import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const backHandlers = [];
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_e, fn) => {
      backHandlers.push(fn);
      return Promise.resolve({ remove: () => {} });
    },
    minimizeApp: (...a) => mockMinimize(...a),
  },
}));
const mockMinimize = vi.fn();

// The destinations render real views with real hooks; this suite is about the
// shell, so each is stubbed down to a marker.
vi.mock('../MobileToday.jsx', () => ({ default: () => <p>TODAY</p> }));
// Progress reads `initialPane` once, on mount, as the real one does, and
// reports pane changes through `onPane`.
vi.mock('../MobileProgress.jsx', async () => {
  const { useState } = await import('react');
  return {
    default: function ProgressStub({ initialPane, onPane }) {
      const [pane, setPane] = useState(initialPane ?? 'load');
      return (
        <>
          <p>PROGRESS</p>
          <span data-testid="progress-pane">{pane}</span>
          <button
            type="button"
            onClick={() => {
              setPane('history');
              onPane?.('history');
            }}
          >
            History pane
          </button>
        </>
      );
    },
  };
});
vi.mock('../../SessionView.jsx', () => ({
  default: ({ sessionId, onBack, layout }) => (
    <div>
      <p>
        SESSION {sessionId} {layout}
      </p>
      <button type="button" onClick={onBack}>
        Leave session
      </button>
    </div>
  ),
}));
vi.mock('../MobileRecovery.jsx', () => ({ default: () => <p>BODY</p> }));
vi.mock('../../ErgLiveView.jsx', () => ({
  default: ({ onExit }) => (
    <div>
      <p>ERG LIVE</p>
      <button type="button" onClick={onExit}>
        Erg exit
      </button>
    </div>
  ),
}));
vi.mock('../MobileSettings.jsx', () => ({ default: () => <p>SETTINGS</p> }));
vi.mock('../../../StrengthLogger.jsx', () => ({
  default: () => <p>STRENGTH LOGGER</p>,
}));
vi.mock('../../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));

import MobileApp from '../MobileApp.jsx';

const back = () => act(() => backHandlers.at(-1)?.());
const tab = (name) => screen.getByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  window.location.hash = '';
  backHandlers.length = 0;
  mockMinimize.mockReset();
});
afterEach(() => {
  window.location.hash = '';
});

describe('MobileApp — the four destinations', () => {
  it('opens on Today', () => {
    render(<MobileApp />);
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    // Today is stubbed to a bare marker: four tabs plus the top bar's Settings.
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /Coach/ })).toBeNull();
  });

  it('shows a tab for each destination and switches between them', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    for (const [label, marker] of [
      ['Progress', 'PROGRESS'],
      ['Body', 'BODY'],
    ]) {
      await user.click(tab(label));
      expect(screen.getByText(marker), label).toBeInTheDocument();
    }
  });

  it('deep-links from the hash', () => {
    window.location.hash = '#/body';
    render(<MobileApp />);
    expect(screen.getByText('BODY')).toBeInTheDocument();
  });

  it('a retired #/coach deep link opens Today, not Body', () => {
    window.location.hash = '#/coach';
    render(<MobileApp />);
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.queryByText('BODY')).toBeNull();
  });
});

describe('the top bar', () => {
  const settings = () => screen.queryByRole('button', { name: 'Settings' });

  it('carries a labelled Settings button on all four destinations (A1)', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    for (const [label, marker] of [
      ['Today', 'TODAY'],
      ['Train', /Erg session/],
      ['Progress', 'PROGRESS'],
      ['Body', 'BODY'],
    ]) {
      await user.click(tab(label));
      expect(screen.getAllByText(marker).length, label).toBeGreaterThan(0);
      expect(settings(), label).toHaveTextContent('Settings');
      expect(screen.getByText('SPLITIQ'), label).toBeInTheDocument();
    }
  });

  it('opens Settings in one tap and is gone while it is open', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Body'));
    await user.click(settings());
    expect(screen.getByText('SETTINGS')).toBeInTheDocument();
    expect(settings()).toBeNull();
    expect(screen.queryByText('SPLITIQ')).toBeNull();
  });

  it('is absent during a live session', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Train'));
    await user.click(screen.getByRole('button', { name: /Erg session/ }));
    expect(screen.getByText('ERG LIVE')).toBeInTheDocument();
    expect(settings()).toBeNull();
    back();
    expect(
      await screen.findByRole('button', { name: 'Settings' })
    ).toBeVisible();
    expect(settings()).not.toHaveFocus();
  });

  it('a Back-from-Settings focus is spent by a live session, not replayed after it', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(settings());
    back();
    expect(settings()).toHaveFocus();
    await user.click(tab('Train'));
    await user.click(screen.getByRole('button', { name: /Erg session/ }));
    expect(settings()).toBeNull();
    back();
    expect(
      await screen.findByRole('button', { name: 'Settings' })
    ).toBeVisible();
    expect(settings()).not.toHaveFocus();
  });
});

describe('a live session owns the screen', () => {
  it('hides the tab bar once a session starts, and restores it on back', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Train'));
    expect(screen.getByRole('button', { name: /Erg session/ })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Erg session/ }));
    expect(screen.getByText('ERG LIVE')).toBeInTheDocument();
    // HANDOFF.md §4 — no tab bar while a piece is running.
    expect(screen.queryByRole('button', { name: /Body/ })).toBeNull();

    back();
    expect(await screen.findByRole('button', { name: /Body/ })).toBeVisible();
  });

  it('leaves an erg session from the screen itself, without the back button', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Train'));
    await user.click(screen.getByRole('button', { name: /Erg session/ }));
    expect(screen.queryByRole('button', { name: /Body/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Erg exit' }));
    expect(screen.queryByText('ERG LIVE')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Strength session/ })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Body/ })).toBeVisible();
  });

  it('leaves a strength session by its Back to Train button', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Train'));
    await user.click(screen.getByRole('button', { name: /Strength session/ }));
    expect(screen.getByText('STRENGTH LOGGER')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to Train' }));
    expect(screen.queryByText('STRENGTH LOGGER')).toBeNull();
    expect(screen.getByRole('button', { name: /Erg session/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Body/ })).toBeVisible();
  });

  it('keeps the session when you step away and come back', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Train'));
    await user.click(screen.getByRole('button', { name: /Strength session/ }));
    expect(screen.getByText('STRENGTH LOGGER')).toBeInTheDocument();

    // Checking Body mid-workout must not discard the piece in progress.
    act(() => {
      window.location.hash = '#/body';
      window.dispatchEvent(new window.Event('hashchange'));
    });
    expect(await screen.findByText('BODY')).toBeInTheDocument();

    await user.click(tab('Train'));
    expect(screen.getByText('STRENGTH LOGGER')).toBeInTheDocument();
  });
});

describe('the session page', () => {
  const goTo = (hash) =>
    act(() => {
      window.location.hash = hash;
      window.dispatchEvent(new window.Event('hashchange'));
    });

  it('opens from a deep link, keeps its URL, and leaves to Progress › History', async () => {
    window.location.hash = '#/session/12';
    const link = document.createElement('a');
    link.setAttribute('href', '#/session/12');
    link.setAttribute('data-session-link', '12');
    document.body.appendChild(link);
    try {
      render(<MobileApp />);
      expect(await screen.findByText('SESSION 12 phone')).toBeInTheDocument();
      expect(window.location.hash).toBe('#/session/12');
      // The top bar steps aside, as it does for Settings.
      expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
      // Reached from outside the app, so Back cannot pop history.
      back();
      expect(await screen.findByText('PROGRESS')).toBeInTheDocument();
      expect(screen.getByTestId('progress-pane')).toHaveTextContent('history');
      await vi.waitFor(() => expect(link).toHaveFocus());
    } finally {
      link.remove();
    }
  });

  it('opened from inside the app, Back pops history', async () => {
    const historyBack = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      render(<MobileApp />);
      await user.click(tab('Progress'));
      goTo('#/session/5');
      expect(await screen.findByText('SESSION 5 phone')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Leave session' }));
      expect(historyBack).toHaveBeenCalledTimes(1);
      back();
      expect(historyBack).toHaveBeenCalledTimes(2);
    } finally {
      historyBack.mockRestore();
    }
  });

  it('Back from a session lands on the History pane once; Progress later opens as usual', async () => {
    const historyBack = vi
      .spyOn(window.history, 'back')
      .mockImplementation(() => goTo('#/progress'));
    try {
      const user = userEvent.setup();
      render(<MobileApp />);
      await user.click(tab('Progress'));
      expect(screen.getByTestId('progress-pane')).toHaveTextContent('load');
      await user.click(screen.getByRole('button', { name: 'History pane' }));
      goTo('#/session/5');
      expect(await screen.findByText('SESSION 5 phone')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Leave session' }));
      expect(historyBack).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('PROGRESS')).toBeInTheDocument();
      expect(screen.getByTestId('progress-pane')).toHaveTextContent('history');
      // Not sticky: away and back to Progress starts on its first pane again.
      await user.click(tab('Body'));
      await user.click(tab('Progress'));
      expect(screen.getByTestId('progress-pane')).toHaveTextContent('load');
    } finally {
      historyBack.mockRestore();
    }
  });

  it('session, then Settings, then Back returns to the session', async () => {
    window.location.hash = '#/session/9';
    render(<MobileApp />);
    expect(await screen.findByText('SESSION 9 phone')).toBeInTheDocument();
    goTo('#/settings');
    expect(await screen.findByText('SETTINGS')).toBeInTheDocument();
    goTo('#/session/9');
    expect(await screen.findByText('SESSION 9 phone')).toBeInTheDocument();
    // Still a deep link: leaving goes to Progress, not out through history.
    back();
    expect(await screen.findByText('PROGRESS')).toBeInTheDocument();
  });

  it('a different session id remounts the page', async () => {
    window.location.hash = '#/session/5';
    render(<MobileApp />);
    expect(await screen.findByText('SESSION 5 phone')).toBeInTheDocument();
    goTo('#/session/6');
    expect(await screen.findByText('SESSION 6 phone')).toBeInTheDocument();
  });

  it('a malformed session link canonicalises to Today', async () => {
    window.location.hash = '#/session/abc';
    render(<MobileApp />);
    expect(await screen.findByText('TODAY')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/today');
  });
});

describe('the hardware back button unwinds one level at a time', () => {
  it('returns to Today from another destination', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Body'));
    expect(screen.getByText('BODY')).toBeInTheDocument();
    back();
    expect(await screen.findByText('TODAY')).toBeInTheDocument();
    expect(mockMinimize).not.toHaveBeenCalled();
  });

  it('minimises the app only from Today', () => {
    render(<MobileApp />);
    back();
    expect(mockMinimize).toHaveBeenCalledTimes(1);
  });

  // Both halves of Capacitor's listener API are async, and React does not
  // await a cleanup — so re-registering per navigation left the order of
  // "old removed" against "new registered" undefined: two listeners holding
  // different closures, or none and a dropped press. Registered once instead,
  // reading the current route from a ref (Seer, PR #293).
  it('registers exactly one listener however much you navigate', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Progress'));
    await user.click(tab('Body'));
    await user.click(tab('Train'));
    await user.click(tab('Today'));
    expect(backHandlers).toHaveLength(1);
  });

  it('the one listener still sees the current route', async () => {
    const user = userEvent.setup();
    render(<MobileApp />);
    await user.click(tab('Progress'));
    back();
    expect(await screen.findByText('TODAY')).toBeInTheDocument();
    expect(mockMinimize).not.toHaveBeenCalled();
  });
});
