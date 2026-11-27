import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import FirstRunGuide from '../FirstRunGuide.jsx';
import SampleDataBadge from '../SampleDataBadge.jsx';
import TestersWelcomeCard from '../TestersWelcomeCard.jsx';
import { SessionOwnerContext } from '../../hooks/useSessionOwner.js';
import { dismissGuide, guideStorageKey } from '../../utils/firstRunGuide.js';
import { GUIDE } from '../../constants/firstRunGuide.js';
import { spacedText } from '../../test/spacedText.js';

vi.mock('../../supabaseClient.js', () => ({
  supabase: { from: () => ({}) },
}));

vi.mock('../../hooks/useSessions.js', () => ({
  useSessions: () => ({ data: [] }),
}));

vi.mock('../../hooks/useAnchors.js', () => ({
  useAnchors: () => ({ cp: null, cpAvailable: false }),
}));

vi.mock('../../utils/testersBuild.js', () => ({
  isTestersBuild: () => true,
}));

function wrap(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (i18n.locale !== 'en') i18n.activate('en');
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionOwnerContext.Provider value="user-a">
          {ui}
        </SessionOwnerContext.Provider>
      </QueryClientProvider>
    </I18nProvider>
  );
}

describe('FirstRunGuide', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('walks through the first two steps and can be skipped', () => {
    wrap(<FirstRunGuide userId="user-a" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Welcome to the test build')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Today')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(guideStorageKey('user-a'))).toBe('done');
  });

  it('does not render once the walkthrough has been dismissed', () => {
    dismissGuide('user-a');
    wrap(<FirstRunGuide userId="user-a" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('H2: page 3 describes the base block and asks for no CP', () => {
    wrap(<FirstRunGuide userId="user-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('Start with easy rowing')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/easy base rowing/);
    // Only what is built: no weekly build-up and no heart-rate following yet.
    expect(spacedText(dialog)).not.toMatch(
      /builds up|each week|heart rate|heart-rate|strap/i
    );
    // No field, no button to save one, no label, and no placeholder.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(spacedText(dialog)).not.toMatch(
      /\bCP\b|critical power|200 ?W|placeholder|watts/i
    );
  });

  it('H1: no page of the guide, in either language, names a CP or the 200 W placeholder', () => {
    for (const locale of ['en', 'es']) {
      expect(JSON.stringify(GUIDE[locale])).not.toMatch(
        /\bCP\b|critical power|potencia crítica|200 ?W|placeholder|provisional de 200/i
      );
    }
    expect(GUIDE.en.steps.map((s) => s.id)).toEqual(
      GUIDE.es.steps.map((s) => s.id)
    );
    expect(GUIDE.en.steps.some((s) => s.hasCp)).toBe(false);
  });
});

describe('SampleDataBadge', () => {
  it('shows the sample flag only on sample sessions', () => {
    const { rerender } = wrap(
      <SampleDataBadge session={{ source: 'sample' }} locale="en" />
    );
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    rerender(
      <I18nProvider i18n={i18n}>
        <SampleDataBadge session={{ source: 'portal' }} locale="en" />
      </I18nProvider>
    );
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
  });
});

describe('TestersWelcomeCard', () => {
  it('invites the tester to open the guide, with no CP field (H1, H2)', () => {
    wrap(<TestersWelcomeCard />);
    const card = screen.getByRole('region', { name: 'Welcome' });
    expect(
      screen.getByRole('button', { name: 'Open the guide' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/CP/)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(spacedText(card)).not.toMatch(/\bCP\b|critical power|200 ?W/i);
  });
});

// #811 copy rewording (Scott, 26 Nov): the guide names only screens the
// testers build has, describes the sample data that 024 really loads, and the
// clear button covers all of it, not only sessions. English and Spanish.
describe('guide copy', () => {
  const text = (locale) => JSON.stringify(GUIDE[locale]);

  it('names no Plan or Log tab and does not send testers to Body for readiness', () => {
    expect(text('en')).not.toMatch(/Use Plan|and Log to|Body is for readiness/);
    expect(text('es')).not.toMatch(
      /Usa Plan|y Registro para|Cuerpo es para la preparación/
    );
    expect(text('en')).toContain('Use Train to plan a session');
    expect(text('es')).toContain('Usa Entrenar para planificar una sesión');
  });

  it('calls it sample data, with no CP or 200 W placeholder in it', () => {
    for (const locale of ['en', 'es']) {
      const samples = GUIDE[locale].steps.find((s) => s.id === 'samples');
      expect(samples.body).not.toMatch(/200 ?W|\bCP\b/);
      expect(samples.body).not.toMatch(/A later change|Un cambio posterior/);
    }
    expect(GUIDE.en.steps.find((s) => s.id === 'samples').title).toBe(
      'Sample data'
    );
    expect(GUIDE.es.steps.find((s) => s.id === 'samples').title).toBe(
      'Datos de ejemplo'
    );
    expect(GUIDE.en.welcomeCard.clearSamples).toBe('Clear sample data');
    expect(GUIDE.es.welcomeCard.clearSamples).toBe('Borrar datos de ejemplo');
    expect(GUIDE.en.welcomeCard.cleared).toBe('Sample data cleared.');
    expect(GUIDE.en.welcomeCard.noneToClear).toBe(
      'There is no sample data on this account.'
    );
    expect(GUIDE.es.welcomeCard.noneToClear).toBe(
      'No hay datos de ejemplo en esta cuenta.'
    );
  });
});
