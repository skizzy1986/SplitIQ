import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LanguageToggle, { LanguageStatus } from '../LanguageToggle.jsx';
import LanguageProvider from '../../i18n/LanguageProvider.jsx';
import '../../i18n/dashboard.js';
import {
  __resetLocaleCacheForTests,
  registerCatalogs,
} from '../../i18n/locale.js';

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

beforeEach(() => {
  __resetLocaleCacheForTests();
  window.localStorage.clear();
});

describe('LanguageToggle', () => {
  it('segmented: one 44px button per language, labelled with its own name (A2, A3)', () => {
    render(
      <LanguageProvider product="dashboard">
        <LanguageToggle />
      </LanguageProvider>
    );
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    const en = screen.getByRole('button', { name: 'English' });
    const es = screen.getByRole('button', { name: 'Español' });
    expect(en).toHaveTextContent(/^English$/);
    expect(es).toHaveTextContent(/^Español$/);
    expect(en).toHaveAttribute('lang', 'en');
    expect(es).toHaveAttribute('lang', 'es-CO');
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(es).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('EN')).toBeNull();
    expect(screen.queryByText('ES')).toBeNull();
    expect(es.style.minWidth).toBe('44px');
    expect(es.style.minHeight).toBe('44px');
  });

  it('cycle: names the target language in that language, described in the current one (B9)', async () => {
    render(
      <LanguageProvider product="dashboard">
        <LanguageToggle variant="cycle" />
      </LanguageProvider>
    );
    const toEs = screen.getByRole('button', { name: 'Español' });
    expect(toEs).toHaveTextContent(/^Español$/);
    expect(toEs).toHaveAttribute('lang', 'es-CO');
    expect(toEs).toHaveAccessibleDescription('Switch the app to Spanish');
    expect(toEs.style.minHeight).toBe('44px');
    fireEvent.click(toEs);
    const toEn = await screen.findByRole('button', { name: 'English' });
    expect(toEn).toHaveAttribute('lang', 'en');
    expect(toEn).toHaveAccessibleDescription('Cambia la app a inglés');
  });

  it('is inert and English outside a provider', () => {
    render(<LanguageToggle variant="cycle" />);
    const button = screen.getByRole('button', { name: 'Español' });
    fireEvent.click(button);
    expect(button).toHaveTextContent('Español');
  });

  it('withStatus={false} leaves the failure line to a LanguageStatus placed elsewhere', async () => {
    registerCatalogs('broken', {
      source: {},
      loaders: { es: () => Promise.reject(new Error('chunk 404')) },
    });
    render(
      <LanguageProvider product="broken">
        <div data-testid="row">
          <LanguageToggle variant="cycle" withStatus={false} />
        </div>
        <div data-testid="below">
          <LanguageStatus />
        </div>
      </LanguageProvider>
    );
    expect(screen.getByTestId('row').querySelector('[aria-live]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Español' }));
    await waitFor(() =>
      expect(screen.getByTestId('below')).toHaveTextContent(
        'Spanish could not be loaded. Check your connection and reload the page.'
      )
    );
    const es = screen.getByText(
      'No se pudo cargar el español. Revisa tu conexión y vuelve a cargar la página.'
    );
    expect(es).toHaveAttribute('lang', 'es-CO');
    expect(es.closest('[aria-live]')).toBe(
      screen.getByTestId('below').querySelector('[aria-live]')
    );
    expect(
      screen.getByTestId('below').querySelector('[aria-live]').textContent
    ).toMatch(/^Spanish could not.*No se pudo/);
    expect(screen.getByTestId('row')).not.toHaveTextContent(/could not/);
  });
});
