import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: null, signIn: null }));
vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    functions: { invoke: (...a) => mocks.invoke(...a) },
    auth: { signInWithPassword: (...a) => mocks.signIn(...a) },
  },
}));

import { submitInviteSignup } from '../inviteSignup.js';

const FORM = {
  email: ' Tester@Example.com ',
  password: 'correct horse',
  confirm: 'correct horse',
  code: ' 7K3M-9QWX-2BDF-HJ4R ',
  consent: true,
};

beforeEach(() => {
  mocks.invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  mocks.signIn = vi.fn().mockResolvedValue({ error: null });
});

describe('submitInviteSignup', () => {
  it('asks the function for the account, then signs in with the same password', async () => {
    const r = await submitInviteSignup(FORM);
    expect(r).toEqual({ ok: true, signedIn: true });
    expect(mocks.invoke).toHaveBeenCalledWith('invite-signup', {
      body: {
        email: 'Tester@Example.com',
        password: 'correct horse',
        code: '7K3M-9QWX-2BDF-HJ4R',
        consent: true,
      },
    });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: 'Tester@Example.com',
      password: 'correct horse',
    });
  });

  it('says so when the account exists but the sign-in failed', async () => {
    mocks.signIn.mockResolvedValue({ error: { message: 'x' } });
    expect(await submitInviteSignup(FORM)).toEqual({
      ok: true,
      signedIn: false,
    });
  });

  it.each([
    ['an empty field', { ...FORM, code: '  ' }, 'missing'],
    ['passwords that differ', { ...FORM, confirm: 'other horse' }, 'mismatch'],
    [
      'a short password',
      { ...FORM, password: 'short', confirm: 'short' },
      'weak_password',
    ],
    ['no consent', { ...FORM, consent: false }, 'consent_required'],
  ])('stops on %s before calling the server', async (_n, form, cause) => {
    expect(await submitInviteSignup(form)).toEqual({ ok: false, cause });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('passes the function’s cause through, and does not sign in', async () => {
    for (const cause of [
      'invalid',
      'weak_password',
      'rate_limited',
      'disabled',
      'server',
    ]) {
      mocks.invoke.mockResolvedValue({
        data: { ok: false, error: cause },
        error: null,
      });
      expect(await submitInviteSignup(FORM)).toEqual({ ok: false, cause });
    }
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('turns an unknown cause into server, and an unreachable function into network', async () => {
    mocks.invoke.mockResolvedValue({
      data: { ok: false, error: 'something_new' },
      error: null,
    });
    expect(await submitInviteSignup(FORM)).toEqual({
      ok: false,
      cause: 'server',
    });
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await submitInviteSignup(FORM)).toEqual({
      ok: false,
      cause: 'network',
    });
    mocks.invoke.mockResolvedValue({ data: { hello: 1 }, error: null });
    expect(await submitInviteSignup(FORM)).toEqual({
      ok: false,
      cause: 'network',
    });
  });
});
