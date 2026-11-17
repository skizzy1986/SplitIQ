import { act, fireEvent, render, screen } from '@testing-library/react';
import SessionState, { resetSettingsVisited } from '../SessionState.jsx';

const retry = () => screen.queryByRole('button', { name: 'Retry' });

beforeEach(() => resetSettingsVisited());
afterEach(() => vi.useRealTimers());

describe('SessionState — when Retry is offered', () => {
  it('rate limited with a retry time: Retry is disabled until it passes', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 10, 9, 0));
    const onRetry = vi.fn();
    const retryAt = new Date(2026, 10, 10, 9, 15).toISOString();
    render(
      <SessionState
        kind="unavailable"
        source="strava"
        reason="rate_limited"
        retryAt={retryAt}
        onRetry={onRetry}
      />
    );
    expect(
      screen.getByText(
        'Strava’s request limit is reached. The trace can load again after 09:15.'
      )
    ).toBeInTheDocument();
    expect(retry()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(15 * 60_000 + 100);
    });
    expect(retry()).toBeEnabled();
    fireEvent.click(retry());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('rate limited with no retry time: Retry at once', () => {
    render(
      <SessionState
        kind="unavailable"
        source="strava"
        reason="rate_limited"
        onRetry={() => {}}
      />
    );
    expect(
      screen.getByText(
        'Strava’s request limit is reached. The trace can load again later.'
      )
    ).toBeInTheDocument();
    expect(retry()).toBeEnabled();
  });

  it('gone: no Retry, since asking again can only spend a request', () => {
    const onRetry = vi.fn();
    render(
      <SessionState
        kind="unavailable"
        source="strava"
        reason="gone"
        onRetry={onRetry}
      />
    );
    expect(
      screen.getByText(
        'This activity is no longer on Strava, so there is no trace.'
      )
    ).toBeInTheDocument();
    expect(retry()).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each(['not_connected', 'auth_failed'])(
    '%s: Retry only after the athlete has been to Settings',
    (reason) => {
      const { unmount } = render(
        <SessionState
          kind="unavailable"
          source="strava"
          reason={reason}
          sessionId={7}
          onRetry={() => {}}
        />
      );
      expect(retry()).toBeNull();
      const settings = screen.getByRole('link', { name: 'Settings' });
      expect(settings).toHaveAttribute('href', '#/settings');
      fireEvent.click(settings);
      unmount();
      // Back from Settings remounts the page.
      render(
        <SessionState
          kind="unavailable"
          source="strava"
          reason={reason}
          sessionId={7}
          onRetry={() => {}}
        />
      );
      expect(retry()).toBeEnabled();
    }
  );

  it('the Settings trip counts for the session it was taken from, and Retry spends it', () => {
    const state = (sessionId, onRetry = () => {}) => (
      <SessionState
        kind="unavailable"
        source="strava"
        reason="not_connected"
        sessionId={sessionId}
        onRetry={onRetry}
      />
    );
    const a = render(state('A'));
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    a.unmount();
    // Another session's page: no Retry there.
    const b = render(state('B'));
    expect(retry()).toBeNull();
    b.unmount();
    // Session A: Retry, and pressing it uses the trip up.
    const onRetry = vi.fn();
    const again = render(state('A', onRetry));
    fireEvent.click(retry());
    expect(onRetry).toHaveBeenCalledTimes(1);
    again.unmount();
    render(state('A'));
    expect(retry()).toBeNull();
  });

  it('attribution pending: no Retry, nothing to wait for', () => {
    render(
      <SessionState
        kind="unavailable"
        source="strava"
        reason="attribution_pending"
        onRetry={() => {}}
      />
    );
    expect(retry()).toBeNull();
  });

  it('an unknown source gets the generic copy, and Retry', () => {
    const { container } = render(
      <SessionState
        kind="unavailable"
        source="capture"
        reason="gone"
        onRetry={() => {}}
      />
    );
    expect(
      screen.getByText('The trace for this session is not available.')
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/strava/i);
    expect(retry()).toBeEnabled();
  });
});

describe('SessionState — no trace against no source', () => {
  it('words a source that answered with no trace apart from no linked source', () => {
    const { unmount } = render(
      <SessionState kind="none" source="strava" reason="no_trace" />
    );
    expect(
      screen.getByText('Strava holds no recorded trace for this activity.')
    ).toBeInTheDocument();
    unmount();
    render(<SessionState kind="none" />);
    expect(
      screen.getByText(
        'This session has a summary only; no trace is linked to it.'
      )
    ).toBeInTheDocument();
  });

  it('a neutral source with no trace gets neutral words', () => {
    const { container } = render(
      <SessionState kind="none" source="capture" reason="no_trace" />
    );
    expect(container.textContent).toBe(
      'No trace was recorded for this session.'
    );
  });
});
