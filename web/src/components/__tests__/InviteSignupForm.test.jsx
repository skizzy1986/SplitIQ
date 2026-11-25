import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { messages as es } from '../../locales/es.po';
import InviteSignupForm from '../InviteSignupForm.jsx';
import { NOTICE, NOTICE_APPROVED } from '../../constants/testerNotice.js';

const mocks = vi.hoisted(() => ({ submit: null, minPassword: 8 }));
vi.mock('../../utils/inviteSignup.js', () => ({
  get MIN_PASSWORD() {
    return mocks.minPassword;
  },
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
  mocks.minPassword = 8;
  mocks.submit = vi.fn().mockResolvedValue({ ok: true, signedIn: true });
});
afterEach(() => i18n.activate('en'));

describe('InviteSignupForm', () => {
  it('shows the approved notice, with no draft banner', () => {
    render(<InviteSignupForm onBack={() => {}} />);
    expect(NOTICE_APPROVED).toBe(true);
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText(NOTICE.en.title)).toBeTruthy();
    for (const p of NOTICE.en.paragraphs) {
      expect(screen.getByText(p)).toBeTruthy();
    }
    expect(screen.getByLabelText(NOTICE.en.consent)).not.toBeChecked();
    expect(screen.queryByText(/DRAFT WORDING/i)).toBeNull();
    expect(screen.queryByText(/BORRADOR/i)).toBeNull();
  });

  it('has a Spanish notice of the same shape', () => {
    expect(NOTICE.es.paragraphs).toHaveLength(NOTICE.en.paragraphs.length);
    expect(NOTICE.es.title).toBeTruthy();
    expect(NOTICE.es.consent).toBeTruthy();
    expect(NOTICE.es).not.toHaveProperty('draft');
    expect(NOTICE.en).not.toHaveProperty('draft');
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

  // Retro Gate 3 (#808, CR 1 / RC 1), the #809 pattern: a short password must
  // reach the app's own check and its EN/ES reason, not the browser's tooltip.
  it('shows the in-app weak-password reason for a short password, in English and in Spanish', async () => {
    mocks.submit.mockResolvedValue({ ok: false, cause: 'weak_password' });
    const short = 'abcdefg';
    const cases = [
      [
        'en',
        'CREATE ACCOUNT',
        `Choose a longer password: at least ${mocks.minPassword} characters.`,
      ],
      [
        'es',
        'CREAR CUENTA',
        `Elige una contraseña más larga: mínimo ${mocks.minPassword} caracteres.`,
      ],
    ];
    for (const [lang, button, text] of cases) {
      if (lang === 'es') {
        i18n.load('es', es);
        i18n.activate('es');
      }
      const user = userEvent.setup();
      const { container, unmount } = render(
        <InviteSignupForm onBack={() => {}} />
      );
      const pw = container.querySelector('#invite-password');
      await user.type(container.querySelector('#invite-code'), 'ABCD-EFGH');
      await user.type(container.querySelector('#invite-email'), 'a@b.co');
      await user.type(pw, short);
      await user.type(container.querySelector('#invite-confirm'), short);
      await user.click(
        screen.getByLabelText(
          lang === 'es' ? NOTICE.es.consent : NOTICE.en.consent
        )
      );
      // jsdom 31 stubs ValidityState.tooShort as always false, so minLength
      // never fails a submit on its own. If the field has a minimum the value
      // does not meet, setCustomValidity so the button click uses the same
      // constraint-validation path a browser would for tooShort.
      if (
        pw.minLength >= 0 &&
        pw.value.length > 0 &&
        pw.value.length < pw.minLength
      ) {
        pw.setCustomValidity('too short');
      }
      await user.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      unmount();
    }
  });

  it('derives the weak-password reason from MIN_PASSWORD, in English and in Spanish', async () => {
    mocks.minPassword = 12;
    mocks.submit.mockResolvedValue({ ok: false, cause: 'weak_password' });
    const cases = [
      [
        'en',
        `Choose a longer password: at least ${mocks.minPassword} characters.`,
      ],
      [
        'es',
        `Elige una contraseña más larga: mínimo ${mocks.minPassword} caracteres.`,
      ],
    ];
    for (const [lang, text] of cases) {
      if (lang === 'es') {
        i18n.load('es', es);
        i18n.activate('es');
      }
      const { container, unmount } = render(
        <InviteSignupForm onBack={() => {}} />
      );
      await act(async () => {
        fireEvent.submit(container.querySelector('form'));
      });
      expect(screen.getByRole('alert')).toHaveTextContent(text);
      unmount();
    }
  });
});
