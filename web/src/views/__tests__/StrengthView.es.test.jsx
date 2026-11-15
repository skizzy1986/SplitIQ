import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { messages as en } from '../../locales/en.po';
import { messages as es } from '../../locales/es.po';
import { messages as viewsEn } from '../../locales/views/en.po';
import { messages as viewsEs } from '../../locales/views/es.po';

// #520: Strength's logger action and Leave logger button render Spanish from the views
// catalog. The rest of the view's copy is still English (its own slice).

vi.mock('../../hooks/useLiftHistory.js', () => ({
  useLiftHistory: () => ({
    data: { lifts: {}, setCount: 0, scoredCount: 0 },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('../../StrengthLogger.jsx', () => ({
  default: () => <div>StrengthLogger-stub</div>,
}));

import StrengthView from '../StrengthView.jsx';
import { DRAFT_KEY } from '../../utils/strengthDraft.js';

// Both dashboard catalogs, as a Spanish visitor with the shell loaded has.
const inSpanish = () => {
  i18n.load('es', { ...en, ...viewsEn, ...es, ...viewsEs });
  i18n.activate('es');
};

describe('StrengthView in Spanish', () => {
  beforeEach(() => localStorage.clear());

  it('labels the logger action and the Leave logger button in es', async () => {
    inSpanish();
    render(<StrengthView strengthSessions={[]} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar una sesión' })
    );
    await screen.findByText('StrengthLogger-stub');

    const leave = screen.getByRole('button', {
      name: 'Salir del registro, volver a las tendencias de fuerza',
    });
    expect(leave).toHaveTextContent('← Salir del registro');
  });

  it('labels the resume action in es when a draft is saved', () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ id: 'd', label: 'Upper A', exercises: [] })
    );
    inSpanish();
    render(<StrengthView strengthSessions={[]} />);
    expect(
      screen.getByRole('button', { name: 'Retomar sesión' })
    ).toBeInTheDocument();
  });
});
