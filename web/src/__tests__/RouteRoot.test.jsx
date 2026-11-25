import { render, screen } from '@testing-library/react';

// What the test is for: /squat and /row must never evaluate
// supabaseClient.js, whose createClient() runs at import. The mock's factory
// only executes if something imports the module, so the spy records exactly
// that.
const mocks = vi.hoisted(() => ({
  native: false,
  supabaseImported: vi.fn(),
  authGateImported: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock('../supabaseClient.js', () => {
  mocks.supabaseImported();
  return { supabase: {} };
});
// AuthGate is the only route to supabaseClient, so "AuthGate never imported"
// is the stronger half of the /squat assertion.
vi.mock('../AuthGate.jsx', () => {
  mocks.authGateImported();
  return { default: () => <div>AuthGate-stub</div> };
});
vi.mock('../utils/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../squat/hooks/useCapabilities.js', () => ({
  useCapabilities: () => ({
    webgl: false,
    decompression: false,
    worker: false,
  }),
}));

async function renderAt(path, { native = false } = {}) {
  mocks.native = native;
  window.history.replaceState(null, '', path);
  vi.resetModules();
  const { default: RouteRoot } = await import('../RouteRoot.jsx');
  return render(<RouteRoot />);
}

beforeEach(() => {
  mocks.supabaseImported.mockClear();
  mocks.authGateImported.mockClear();
  globalThis.fetch = vi.fn(() => new Promise(() => {}));
});

describe('RouteRoot', () => {
  it('renders the squat tool at /squat without importing supabaseClient', async () => {
    await renderAt('/squat');
    expect(
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: 'High-bar back squat',
        },
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(mocks.authGateImported).not.toHaveBeenCalled();
    expect(mocks.supabaseImported).not.toHaveBeenCalled();
  });

  it('treats /squat/ the same and canonicalises it in place', async () => {
    window.history.replaceState(null, '', '/squat/#guide=metrics');
    await renderAt('/squat/#guide=metrics');
    expect(window.location.pathname).toBe('/squat');
    expect(window.location.hash).toBe('#guide=metrics');
    expect(
      await screen.findByText('High-bar back squat', {}, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(mocks.supabaseImported).not.toHaveBeenCalled();
  });

  it('paints the loading ground in the stored squat theme', async () => {
    window.localStorage.setItem('splitiq.theme', 'dark');
    try {
      await renderAt('/squat');
      const ground = screen.getByTestId('route-ground');
      expect(ground).toHaveAttribute('data-theme', 'dark');
      expect(ground.style.colorScheme).toBe('dark');
      await screen.findByText('High-bar back squat', {}, { timeout: 5000 });
    } finally {
      window.localStorage.clear();
    }
  });

  // Before any test that loads AuthGate: Vitest runs a mock's factory once
  // per file, even across vi.resetModules(), so authGateImported records only
  // the first import and would stay silent here afterwards.
  it('renders the row tool at /row without importing supabaseClient', async () => {
    await renderAt('/row');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Rowing stroke' },
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(mocks.authGateImported).not.toHaveBeenCalled();
    expect(mocks.supabaseImported).not.toHaveBeenCalled();
  });

  it('treats /row/ the same and canonicalises it in place', async () => {
    await renderAt('/row/?a=1#x');
    expect(window.location.pathname).toBe('/row');
    expect(window.location.search).toBe('?a=1');
    expect(window.location.hash).toBe('#x');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Rowing stroke' },
        { timeout: 5000 }
      )
    ).toBeInTheDocument();
    expect(mocks.authGateImported).not.toHaveBeenCalled();
    expect(mocks.supabaseImported).not.toHaveBeenCalled();
  });

  // Light, which the dashboard would never paint: the ground follows the
  // stored preference because /row is a movement tool.
  it("paints /row's loading ground in the stored theme", async () => {
    window.localStorage.setItem('splitiq.theme', 'light');
    try {
      await renderAt('/row');
      const ground = screen.getByTestId('route-ground');
      expect(ground).toHaveAttribute('data-theme', 'light');
      expect(ground.style.colorScheme).toBe('light');
      expect(screen.getByTestId('theme-root')).toHaveAttribute(
        'data-theme',
        'light'
      );
      expect(
        await screen.findByTestId('row-root', {}, { timeout: 5000 })
      ).toHaveAttribute('data-theme', 'light');
    } finally {
      window.localStorage.clear();
    }
  });

  it('renders AuthGate at / and starts loading it at module scope', async () => {
    await renderAt('/');
    expect(await screen.findByText('AuthGate-stub')).toBeInTheDocument();
    expect(mocks.authGateImported).toHaveBeenCalled();
  });

  it('always renders AuthGate in the native app, even at /squat', async () => {
    await renderAt('/squat', { native: true });
    expect(await screen.findByText('AuthGate-stub')).toBeInTheDocument();
    expect(screen.queryByText('High-bar back squat')).toBeNull();
  });
  it('paints the dashboard loading ground dark even when light is stored', async () => {
    window.localStorage.setItem('splitiq.theme', 'light');
    try {
      await renderAt('/');
      expect(screen.getByTestId('route-ground')).toHaveAttribute(
        'data-theme',
        'dark'
      );
      expect(screen.getByTestId('theme-root')).toHaveAttribute(
        'data-theme',
        'dark'
      );
      await screen.findByText('AuthGate-stub');
    } finally {
      window.localStorage.clear();
    }
  });

  it('always renders AuthGate in the native app, even at /row', async () => {
    await renderAt('/row', { native: true });
    expect(await screen.findByText('AuthGate-stub')).toBeInTheDocument();
    expect(screen.queryByText('Rowing stroke')).toBeNull();
  });

  it.each(['/rows', '/row/extra', '/ROW'])(
    'renders AuthGate at %s, which is not a tool path',
    async (path) => {
      await renderAt(path);
      expect(await screen.findByText('AuthGate-stub')).toBeInTheDocument();
      expect(window.location.pathname).toBe(path);
    }
  );
});
