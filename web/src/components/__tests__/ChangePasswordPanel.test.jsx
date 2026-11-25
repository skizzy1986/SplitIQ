import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { messages as es } from '../../locales/views/es.po';
import ChangePasswordPanel from '../ChangePasswordPanel.jsx';
import { MIN_PASSWORD } from '../../utils/changePassword.js';

const mocks = vi.hoisted(() => ({ change: null, minPassword: 8 }));
vi.mock('../../utils/changePassword.js', () => ({
  get MIN_PASSWORD() {
    return mocks.minPassword;
  },
  changePassword: (...a) => mocks.change(...a),
}));

const fill = (container, current, next, confirm) => {
  fireEvent.change(container.querySelector('#pw-current'), {
    target: { value: current },
  });
  fireEvent.change(container.querySelector('#pw-new'), {
    target: { value: next },
  });
  fireEvent.change(container.querySelector('#pw-confirm'), {
    target: { value: confirm },
  });
};
const submit = (container) =>
  act(async () => {
    fireEvent.submit(container.querySelector('form'));
  });

beforeEach(() => {
  mocks.minPassword = 8;
  mocks.change = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => i18n.activate('en'));

describe('ChangePasswordPanel', () => {
  it('sends the three fields, then says so and clears them', async () => {
    const { container } = render(<ChangePasswordPanel />);
    fill(container, 'old password', 'new password 1', 'new password 1');
    await submit(container);
    expect(mocks.change).toHaveBeenCalledWith({
      current: 'old password',
      next: 'new password 1',
      confirm: 'new password 1',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Password changed.');
    expect(container.querySelector('#pw-current').value).toBe('');
    expect(container.querySelector('#pw-new').value).toBe('');
    expect(container.querySelector('#pw-confirm').value).toBe('');
  });

  it.each([
    ['mismatch', "The two new passwords don't match."],
    [
      'weak_password',
      `Choose a longer new password: at least ${MIN_PASSWORD} characters.`,
    ],
    ['wrong_current', 'The current password is not right.'],
    ['same', 'The new password must be different from the current one.'],
  ])('shows the %s cause and keeps what was typed', async (cause, text) => {
    mocks.change.mockResolvedValue({ ok: false, cause });
    const { container } = render(<ChangePasswordPanel />);
    fill(container, 'old password', 'new password 1', 'new password 1');
    await submit(container);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('#pw-new').value).toBe('new password 1');
  });

  it('never prints a password on screen', async () => {
    mocks.change.mockResolvedValue({ ok: false, cause: 'failed' });
    const { container } = render(<ChangePasswordPanel />);
    fill(container, 'old password', 'new password 1', 'new password 1');
    await submit(container);
    expect(container.textContent).not.toContain('old password');
    expect(container.textContent).not.toContain('new password 1');
  });

  it('disables the button while the request is out', async () => {
    let resolve;
    mocks.change = vi.fn(() => new Promise((r) => (resolve = r)));
    const { container } = render(<ChangePasswordPanel />);
    await submit(container);
    expect(screen.getByRole('button', { name: 'Changing…' })).toBeDisabled();
    await act(async () => resolve({ ok: true }));
    expect(
      screen.getByRole('button', { name: 'Change password' })
    ).toBeEnabled();
  });

  it('speaks Spanish when Spanish is active', async () => {
    i18n.load('es', es);
    i18n.activate('es');
    mocks.change.mockResolvedValue({ ok: false, cause: 'wrong_current' });
    const { container } = render(<ChangePasswordPanel />);
    expect(
      screen.getByRole('button', { name: 'Cambiar contraseña' })
    ).toBeTruthy();
    await submit(container);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La contraseña actual no es correcta.'
    );
  });

  it('shows the in-app weak-password reason for a short password, in English and in Spanish', async () => {
    mocks.change.mockResolvedValue({ ok: false, cause: 'weak_password' });
    const short = 'abcdefg';
    const cases = [
      [
        'en',
        'Change password',
        `Choose a longer new password: at least ${MIN_PASSWORD} characters.`,
      ],
      [
        'es',
        'Cambiar contraseña',
        `Elige una contraseña nueva más larga: mínimo ${MIN_PASSWORD} caracteres.`,
      ],
    ];
    for (const [lang, button, text] of cases) {
      if (lang === 'es') {
        i18n.load('es', es);
        i18n.activate('es');
      }
      const user = userEvent.setup();
      const { container, unmount } = render(<ChangePasswordPanel />);
      const next = container.querySelector('#pw-new');
      await user.type(container.querySelector('#pw-current'), 'old password');
      await user.type(next, short);
      await user.type(container.querySelector('#pw-confirm'), short);
      // jsdom 31 stubs ValidityState.tooShort as always false, so minLength
      // never fails a submit on its own. If the field has a minimum the value
      // does not meet, setCustomValidity so the button click uses the same
      // constraint-validation path a browser would for tooShort.
      if (
        next.minLength >= 0 &&
        next.value.length > 0 &&
        next.value.length < next.minLength
      ) {
        next.setCustomValidity('too short');
      }
      await user.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      unmount();
    }
  });

  it('derives the weak-password reason from MIN_PASSWORD, in English and in Spanish', async () => {
    mocks.minPassword = 12;
    mocks.change.mockResolvedValue({ ok: false, cause: 'weak_password' });
    const cases = [
      [
        'en',
        `Choose a longer new password: at least ${mocks.minPassword} characters.`,
      ],
      [
        'es',
        `Elige una contraseña nueva más larga: mínimo ${mocks.minPassword} caracteres.`,
      ],
    ];
    for (const [lang, text] of cases) {
      if (lang === 'es') {
        i18n.load('es', es);
        i18n.activate('es');
      }
      const { container, unmount } = render(<ChangePasswordPanel />);
      fill(container, 'old password', 'new password 1', 'new password 1');
      await submit(container);
      expect(screen.getByRole('alert')).toHaveTextContent(text);
      unmount();
    }
  });
});
