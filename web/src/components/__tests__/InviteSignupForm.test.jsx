import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { messages as es } from '../../locales/es.po';
import InviteSignupForm from '../InviteSignupForm.jsx';
import { NOTICE, NOTICE_APPROVED } from '../../constants/testerNotice.js';

const mocks = vi.hoisted(() => ({ submit: null }));
vi.mock('../../utils/inviteSignup.js', () => ({
  MIN_PASSWORD: 8,
  submitInviteSignup: (...a) => mocks.submit(...a),
}));

const fill = (container, values) => {
  const byId = (id) => container.querySelector(`#${id}`);
  fireEvent.change(byId('invite-code'), { target: { value: values.code } });
  fireEvent.change(byId('invite-email'), { target: { value: values.email } });
  fireEvent.change(byId('invite-password'), {
    target: { value: values.password },
  });
  fireEvent.change(byId('invite-confirm'), {
    target: { value: values.confirm },
  });
};

beforeEach(() => {
  mocks.submit = vi.fn().mockResolvedValue({ ok: true, signedIn: true });
});
afterEach(() => i18n.activate('en'));

describe('InviteSignupForm', () => {
  it('shows the notice, marked as a draft until Scott approves it', () => {
    render(<InviteSignupForm onBack={() => {}} />);
    expect(NOTICE_APPROVED).toBe(false);
    expect(screen.getByRole('note').textContent).toBe(NOTICE.en.draft);
    expect(screen.getByText(NOTICE.en.title)).toBeTruthy();
    for (const p of NOTICE.en.paragraphs) {
      expect(screen.getByText(p)).toBeTruthy();
    }
    expect(screen.getByLabelText(NOTICE.en.consent)).not.toBeChecked();
  });

  it('has a Spanish notice of the same shape', () => {
    expect(NOTICE.es.paragraphs).toHaveLength(NOTICE.en.paragraphs.length);
    expect(NOTICE.es.draft).toBeTruthy();
    expect(NOTICE.es.consent).toBeTruthy();
  });

  it('shows the Spanish notice and Spanish errors when Spanish is active', async () => {
    i18n.load('es', es);
    i18n.activate('es');
    mocks.submit.mockResolvedValue({ ok: false, cause: 'missing' });
    const { container } = render(<InviteSignupForm onBack={() => {}} />);
    expect(screen.getByText(NOTICE.es.title)).toBeTruthy();
    expect(screen.getByLabelText(NOTICE.es.consent)).toBeTruthy();
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Completa todos los campos.'
    );
  });

  it('sends what was typed, with the consent tick', async () => {
    const { container } = render(<InviteSignupForm onBack={() => {}} />);
    fill(container, {
      code: '7K3M-9QWX-2BDF-HJ4R',
      email: 'a@b.co',
      password: 'correct horse',
      confirm: 'correct horse',
    });
    fireEvent.click(screen.getByLabelText(NOTICE.en.consent));
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(mocks.submit).toHaveBeenCalledWith({
      code: '7K3M-9QWX-2BDF-HJ4R',
      email: 'a@b.co',
      password: 'correct horse',
      confirm: 'correct horse',
      consent: true,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the button while the request is out, then shows the cause', async () => {
    let resolve;
    mocks.submit = vi.fn(() => new Promise((r) => (resolve = r)));
    const { container } = render(<InviteSignupForm onBack={() => {}} />);
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(screen.getByRole('button', { name: 'CREATING…' })).toBeDisabled();
    await act(async () => resolve({ ok: false, cause: 'invalid' }));
    expect(
      screen.getByRole('button', { name: 'CREATE ACCOUNT' })
    ).toBeEnabled();
    // One answer for every bad code, so it never says which part was wrong.
    expect(screen.getByRole('alert').textContent).toMatch(
      /code and email did not work/
    );
  });

  it('never prints the password or the code back', async () => {
    mocks.submit.mockResolvedValue({ ok: false, cause: 'weak_password' });
    const { container } = render(<InviteSignupForm onBack={() => {}} />);
    fill(container, {
      code: 'SECRETCODE12',
      email: 'a@b.co',
      password: 'hunter2hunter2',
      confirm: 'hunter2hunter2',
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(container.textContent).not.toContain('hunter2hunter2');
    expect(container.textContent).not.toContain('SECRETCODE12');
  });

  it('goes back to sign in from the link, and after an account that could not sign in', async () => {
    const onBack = vi.fn();
    const { container } = render(<InviteSignupForm onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    mocks.submit.mockResolvedValue({ ok: true, signedIn: false });
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
