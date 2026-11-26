import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import AuthGate from '../AuthGate.jsx';
import { SPLASH_MIN_MS } from '../hooks/useSplashGate.js';

// The invite link on the login screen (#791): there on a testers build, absent
// on every other. The form itself is covered in InviteSignupForm.test.jsx.
const mocks = vi.hoisted(() => ({ testers: false }));

vi.mock('../supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('../utils/testersBuild.js', () => ({
  isTestersBuild: () => mocks.testers,
}));
vi.mock('../hooks/useIsMobile.js', () => ({ useIsMobile: () => true }));
vi.mock('../hooks/useInitialDataReady.js', () => ({
  useInitialDataReady: () => false,
}));
vi.mock('../hooks/usePWAInstall.js', () => ({
  usePWAInstall: () => ({
    canInstall: false,
    installed: false,
    installPrompt: null,
  }),
}));
vi.mock('../components/SplashScreen.jsx', () => ({
  default: () => <div data-testid="splash-stub" />,
}));
vi.mock('../App.jsx', () => ({ default: () => <div>App-stub</div> }));
vi.mock('../views/mobile/MobileApp.jsx', () => ({
  default: () => <div>MobileApp-stub</div>,
}));
vi.mock('../utils/sentry.js', () => ({ captureError: vi.fn() }));

const LINK = 'Have an invite code?';

async function loginScreen() {
  render(<AuthGate />);
  await act(async () => {});
  act(() => vi.advanceTimersByTime(SPLASH_MIN_MS));
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.testers = false;
});
afterEach(() => vi.useRealTimers());

describe('login screen on a testers build', () => {
  it('has no invite link on the official build', async () => {
    await loginScreen();
    expect(screen.getByText(/Sign in to continue/)).toBeTruthy();
    expect(screen.queryByText(LINK)).toBeNull();
  });

  it('shows the link on a testers build, opens the form, and comes back', async () => {
    mocks.testers = true;
    await loginScreen();
    fireEvent.click(screen.getByText(LINK));
    // The form is a lazy chunk; real timers let findBy poll for it.
    vi.useRealTimers();
    expect(await screen.findByText('Create your test account')).toBeTruthy();
    expect(screen.queryByText(/Sign in to continue/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByText(/Sign in to continue/)).toBeTruthy();
  });
});
