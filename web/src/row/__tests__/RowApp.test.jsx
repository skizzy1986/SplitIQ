import { act, render, screen } from '@testing-library/react';
// RTL's real entry, by the file path the suite's shim re-exports: no Lingui
// provider is wrapped around the render (src/test/rtl.js).
import { render as renderBare } from '@testing-library/react/dist/index.js';
import RowApp from '../RowApp.jsx';
import {
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PLACEHOLDER,
} from '../constants/page.js';
import { DARK, LIGHT } from '../../constants/themeValues.js';
import { THEME_KEY } from '../../utils/themePreference.js';

const meta = (name) => document.querySelector(`meta[name="${name}"]`);
// jsdom reports a set colour in rgb(), so compare through the same parser.
const asCss = (hex) => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = hex;
  return probe.style.backgroundColor;
};
const osPrefersDark = (matches) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );

beforeEach(() => {
  document.title = 'SplitIQ';
});
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('RowApp', () => {
  it('renders the heading, sentence and a link to /squat', () => {
    render(<RowApp />);
    const main = screen.getByRole('main');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rowing stroke' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(main).toHaveTextContent(
      'The 3D model of the rowing stroke is being built. It is not ready yet.'
    );
    const link = screen.getByRole('link', { name: 'Open the squat model' });
    expect(link).toHaveAttribute('href', '/squat');
    expect(main).toContainElement(link);
    // A 44 px touch target (WCAG 2.5.5).
    expect(link.style.minHeight).toBe('44px');
    expect(PLACEHOLDER.squatHref).toBe('/squat');
  });

  it('sets title, description and robots noindex, and restores them on unmount', () => {
    const { unmount } = render(<RowApp />);
    expect(document.title).toBe(PAGE_TITLE);
    expect(PAGE_TITLE).toBe('Rowing stroke — SplitIQ');
    expect(meta('description')).toHaveAttribute('content', PAGE_DESCRIPTION);
    expect(PAGE_DESCRIPTION).toBe(
      'The rowing stroke, modelled in 3D. Not ready yet.'
    );
    expect(meta('robots')).toHaveAttribute('content', 'noindex');
    unmount();
    expect(document.title).toBe('SplitIQ');
    expect(meta('description')).toBeNull();
    expect(meta('robots')).toBeNull();
  });

  it('keeps existing description and robots tags, restoring what they said', () => {
    const description = document.createElement('meta');
    description.setAttribute('name', 'description');
    description.setAttribute('content', 'Dashboard');
    const robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    document.head.append(description, robots);
    try {
      const { unmount } = render(<RowApp />);
      expect(description).toHaveAttribute('content', PAGE_DESCRIPTION);
      expect(robots).toHaveAttribute('content', 'noindex');
      unmount();
      expect(description).toHaveAttribute('content', 'Dashboard');
      expect(robots.hasAttribute('content')).toBe(false);
      expect(meta('robots')).toBe(robots);
    } finally {
      description.remove();
      robots.remove();
    }
  });

  it('follows the stored theme and sets the document ground', () => {
    const themeColor = document.createElement('meta');
    themeColor.setAttribute('name', 'theme-color');
    themeColor.setAttribute('content', 'initial');
    document.head.appendChild(themeColor);
    const previousGround = document.body.style.backgroundColor;
    window.localStorage.setItem(THEME_KEY, 'light');
    try {
      const { unmount } = render(<RowApp />);
      const root = screen.getByTestId('row-root');
      expect(root).toHaveAttribute('data-theme', 'light');
      expect(root.style.colorScheme).toBe('light');
      expect(document.body.style.backgroundColor).toBe(asCss(LIGHT.bg));
      expect(themeColor).toHaveAttribute('content', LIGHT.bg);

      // Another surface (the dashboard's control, /squat's switch) changes
      // the shared preference: the open page follows without a reload.
      act(() =>
        window.dispatchEvent(
          new window.CustomEvent('splitiq:theme-change', { detail: 'dark' })
        )
      );
      expect(root).toHaveAttribute('data-theme', 'dark');
      expect(document.body.style.backgroundColor).toBe(asCss(DARK.bg));
      expect(themeColor).toHaveAttribute('content', DARK.bg);

      unmount();
      expect(document.body.style.backgroundColor).toBe(previousGround);
      expect(themeColor).toHaveAttribute('content', 'initial');
    } finally {
      themeColor.remove();
    }
  });

  it('follows the OS under Auto, as /squat does', () => {
    osPrefersDark(true);
    render(<RowApp />);
    expect(screen.getByTestId('row-root')).toHaveAttribute(
      'data-theme',
      'dark'
    );
  });

  it('needs no provider above it: RouteRoot mounts none for /row', () => {
    osPrefersDark(false);
    renderBare(<RowApp />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rowing stroke' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('row-root')).toHaveAttribute(
      'data-theme',
      'light'
    );
  });
});
