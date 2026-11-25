import { Component } from 'react';
import { render, screen } from '@testing-library/react';

// The first-visit offline fallback: RouteRoot's lazy import of a tool's
// chunk rejects. Offline, a message replaces the blank ground; online, the
// rejection is rethrown for the error boundary to report.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('../AuthGate.jsx', () => ({ default: () => null }));
vi.mock('../squat/SquatApp.jsx', () => {
  throw new Error('Failed to fetch dynamically imported module');
});
vi.mock('../row/RowApp.jsx', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? <p>boundary caught</p> : this.props.children;
  }
}

let online = true;
beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
});
afterEach(() => {
  delete window.navigator.onLine;
});

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  const { default: RouteRoot } = await import('../RouteRoot.jsx');
  return render(
    <Boundary>
      <RouteRoot />
    </Boundary>
  );
}
const renderSquat = () => renderAt('/squat');

describe('RouteRoot offline first visit', () => {
  it('says a connection is needed when the chunk fails offline', async () => {
    online = false;
    await renderSquat();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /needs a connection the first time/
    );
  });

  it('rethrows the failure when online', async () => {
    online = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderSquat();
      expect(await screen.findByText('boundary caught')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('says the rowing tool needs a connection when its chunk fails offline', async () => {
    online = false;
    await renderAt('/row');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The rowing tool needs a connection the first time. Reconnect and reload.'
    );
    expect(alert).toHaveAttribute('lang', 'en');
  });

  it('rethrows the row chunk failure when online', async () => {
    online = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderAt('/row');
      expect(await screen.findByText('boundary caught')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
