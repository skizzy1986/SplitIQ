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

  it('offers a CP field on the CP step, and stays out of the message catalogs', () => {
    wrap(<FirstRunGuide userId="user-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Your rowing CP')).toBeInTheDocument();
    expect(screen.getByLabelText('Rowing CP (watts)')).toBeInTheDocument();
    expect(screen.getByText('Rowing CP not set yet.')).toBeInTheDocument();
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
  it('invites the tester to open the guide and set CP', () => {
    wrap(<TestersWelcomeCard />);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open the guide' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Rowing CP (watts)')).toBeInTheDocument();
  });
});
