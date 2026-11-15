import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { i18n } from '@lingui/core';
import ThemeControl from '../components/ThemeControl.jsx';
import { DARK, LIGHT } from '../constants/themeValues.js';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('../AuthGate.jsx', () => ({
  default: function Dashboard() {
    const [settings, setSettings] = useState(true);
    return (
      <>
        <button onClick={() => setSettings(!settings)}>Toggle settings</button>
        {settings && <ThemeControl />}
      </>
    );
  },
}));
import RouteRoot from '../RouteRoot.jsx';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('applies accessible theme choices to the dashboard and persists the shared key', async () => {
  render(<RouteRoot />);
  await screen.findByRole('group', { name: 'Theme' });
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByTestId('theme-root')).toHaveAttribute(
    'data-theme',
    'dark'
  );
  expect(localStorage.getItem('splitiq.theme')).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
  expect(screen.getByTestId('theme-root')).toHaveAttribute(
    'data-theme',
    'light'
  );
  expect(localStorage.getItem('splitiq.theme')).toBeNull();
});

it('retains an in-memory choice when Settings closes and storage writes fail', async () => {
  vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  render(<RouteRoot />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dark' }));
  fireEvent.click(screen.getByText('Toggle settings'));
  fireEvent.click(screen.getByText('Toggle settings'));
  expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByTestId('theme-root')).toHaveAttribute(
    'data-theme',
    'dark'
  );
});

it('themes the document ground and browser chrome, restoring them on unmount', async () => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = LIGHT.bg;
  document.head.appendChild(meta);
  const previous = document.body.style.backgroundColor;
  const { unmount } = render(<RouteRoot />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dark' }));
  expect(meta.content).toBe(DARK.bg);
  const expected = document.createElement('div');
  expected.style.backgroundColor = DARK.bg;
  expect(document.body.style.backgroundColor).toBe(
    expected.style.backgroundColor
  );
  unmount();
  expect(meta.content).toBe(LIGHT.bg);
  expect(document.body.style.backgroundColor).toBe(previous);
  meta.remove();
});

it('labels the control and every choice in Spanish', async () => {
  const { messages } = await import('../locales/es.po');
  const { messages: views } = await import('../locales/views/es.po');
  i18n.load('es', { ...messages, ...views });
  act(() => i18n.activate('es'));
  render(<RouteRoot />);
  await screen.findByRole('group', { name: 'Tema' });
  expect(screen.getByRole('button', { name: 'Claro' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Oscuro' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Automático' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
