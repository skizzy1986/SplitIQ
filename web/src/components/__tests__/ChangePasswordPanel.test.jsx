import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { messages as es } from '../../locales/views/es.po';
import ChangePasswordPanel from '../ChangePasswordPanel.jsx';

const mocks = vi.hoisted(() => ({ change: null }));
vi.mock('../../utils/changePassword.js', () => ({
  MIN_PASSWORD: 8,
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
    ['weak_password', 'Choose a longer new password: at least 8 characters.'],
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
});
