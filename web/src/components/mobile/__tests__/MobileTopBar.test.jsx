import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { messages as viewsEn } from '../../../locales/views/en.po';
import { messages as viewsEs } from '../../../locales/views/es.po';
import MobileTopBar from '../MobileTopBar.jsx';

afterEach(() => {
  i18n.activate('en');
});

describe('MobileTopBar', () => {
  it('shows the wordmark and a Settings button with visible text, 44px (A1, A2)', () => {
    render(<MobileTopBar onOpenSettings={() => {}} />);
    expect(screen.getByText('SPLITIQ')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveTextContent(/^Settings$/);
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
  });

  it('clears the notch', () => {
    render(<MobileTopBar onOpenSettings={() => {}} />);
    expect(document.querySelector('header').style.padding).toContain(
      'safe-area-inset-top'
    );
  });

  it('is labelled in Spanish from the views catalog', () => {
    i18n.load('es', { ...viewsEn, ...viewsEs });
    i18n.activate('es');
    render(<MobileTopBar onOpenSettings={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Configuración' })
    ).toHaveTextContent('Configuración');
  });

  it('opens Settings from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<MobileTopBar onOpenSettings={onOpen} />);
    screen.getByRole('button', { name: 'Settings' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('takes focus when asked to (returning from Settings), not by default', () => {
    const ref = createRef();
    const { unmount } = render(
      <MobileTopBar onOpenSettings={() => {}} settingsRef={ref} />
    );
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveFocus();
    unmount();
    render(
      <MobileTopBar onOpenSettings={() => {}} settingsRef={ref} focusSettings />
    );
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });
});
