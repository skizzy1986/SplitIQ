import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: null,
  signIn: null,
  updateUser: null,
}));
vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: (...a) => mocks.getSession(...a),
      signInWithPassword: (...a) => mocks.signIn(...a),
      updateUser: (...a) => mocks.updateUser(...a),
    },
  },
}));

import { changePassword } from '../changePassword.js';

const FORM = {
  current: 'old password',
  next: 'new password 1',
  confirm: 'new password 1',
};

beforeEach(() => {
  mocks.getSession = vi.fn().mockResolvedValue({
    data: { session: { user: { email: 't@example.com' } } },
  });
  mocks.signIn = vi.fn().mockResolvedValue({ error: null });
  mocks.updateUser = vi.fn().mockResolvedValue({ error: null });
});

describe('changePassword', () => {
  it('checks the current password, then sets the new one', async () => {
    expect(await changePassword(FORM)).toEqual({ ok: true });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 't@example.com',
      password: 'old password',
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: 'new password 1',
    });
    // The check comes first.
    expect(mocks.signIn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUser.mock.invocationCallOrder[0]
    );
  });

  it.each([
    ['an empty field', { ...FORM, current: '' }, 'missing'],
    [
      'new passwords that differ',
      { ...FORM, confirm: 'different 123' },
      'mismatch',
    ],
    [
      'a short new password',
      { ...FORM, next: 'short', confirm: 'short' },
      'weak_password',
    ],
    [
      'the same password',
      {
        current: 'same password',
        next: 'same password',
        confirm: 'same password',
      },
      'same',
    ],
  ])('stops on %s without calling the server', async (_n, form, cause) => {
    expect(await changePassword(form)).toEqual({ ok: false, cause });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('refuses a 7-character new password and accepts an 8-character one', async () => {
    const seven = 'abcdefg';
    const eight = 'abcdefgh';
    expect(
      await changePassword({
        current: 'old password',
        next: seven,
        confirm: seven,
      })
    ).toEqual({ ok: false, cause: 'weak_password' });
    expect(mocks.updateUser).not.toHaveBeenCalled();

    expect(
      await changePassword({
        current: 'old password',
        next: eight,
        confirm: eight,
      })
    ).toEqual({ ok: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: eight });
  });

  it('asks for a fresh sign-in when there is no session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect(await changePassword(FORM)).toEqual({ ok: false, cause: 'session' });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('does not change anything when the current password is wrong', async () => {
    mocks.signIn.mockResolvedValue({ error: { code: 'invalid_credentials' } });
    expect(await changePassword(FORM)).toEqual({
      ok: false,
      cause: 'wrong_current',
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('tells an offline check from any other failure', async () => {
    mocks.signIn.mockResolvedValue({
      error: { name: 'AuthRetryableFetchError' },
    });
    expect(await changePassword(FORM)).toEqual({ ok: false, cause: 'network' });
    mocks.signIn.mockResolvedValue({ error: { code: 'something_else' } });
    expect(await changePassword(FORM)).toEqual({ ok: false, cause: 'failed' });
  });

  it('maps the server’s answer to the update', async () => {
    for (const [error, cause] of [
      [{ code: 'weak_password' }, 'weak_password'],
      [{ code: 'same_password' }, 'same'],
      [{ name: 'AuthRetryableFetchError' }, 'network'],
      [{ code: 'unexpected' }, 'failed'],
    ]) {
      mocks.updateUser.mockResolvedValue({ error });
      expect(await changePassword(FORM)).toEqual({ ok: false, cause });
    }
  });
});
