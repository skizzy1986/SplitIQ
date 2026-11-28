import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdvancedCpForm from '../AdvancedCpForm.jsx';
import { CP_FORM } from '../../constants/cpFormCopy.js';

function setup({ currentCp = 215, onSave = vi.fn() } = {}) {
  const view = render(
    <AdvancedCpForm copy={CP_FORM.en} currentCp={currentCp} onSave={onSave} />
  );
  const input = screen.getByLabelText('Rowing CP (watts)');
  return { input, onSave, view };
}

// #819 S4. The form is props in: onSave is the only way out, and the parent
// (Settings > Advanced) does the RPC. These tests pin what the user sees.
describe('AdvancedCpForm', () => {
  it('H38: manual CP saves as manual and unvalidated; seeds after load', async () => {
    // The parent mounts the form once the anchors read has answered, with the
    // saved CP, so the field starts from it, not blank.
    const onSave = vi.fn().mockResolvedValue({ ok: true, watts: 230 });
    const { input } = setup({ currentCp: 215, onSave });
    expect(input).toHaveValue(215);
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rowing CP saved.'
    );
    expect(onSave).toHaveBeenCalledWith('230');
  });

  it('H38: a refetch that changes the CP prop does not overwrite what the user is typing', () => {
    const { input, view } = setup({ currentCp: 215 });
    fireEvent.change(input, { target: { value: '24' } });
    view.rerender(
      <AdvancedCpForm copy={CP_FORM.en} currentCp={260} onSave={vi.fn()} />
    );
    expect(input).toHaveValue(24);
  });

  it('starts empty when there is no CP yet', () => {
    const { input } = setup({ currentCp: null });
    expect(input).toHaveValue(null);
  });

  it('a failed save says so and shows no saved message', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, cause: 'error' });
    const { input } = setup({ onSave });
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save that. Try again.'
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('A32: a stale save says another device changed it', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, cause: 'stale' });
    const { input } = setup({ onSave });
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your CP changed on another device.'
    );
  });

  it('an invalid value shows the range message', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, cause: 'invalid' });
    const { input } = setup({ onSave });
    fireEvent.change(input, { target: { value: '12' } });
    // The browser's own min check stops a click; submit skips it, as a
    // browser without constraint validation would.
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a whole number between 50 and 500.'
    );
  });

  it('Spanish copy renders through the same props', () => {
    render(
      <AdvancedCpForm copy={CP_FORM.es} currentCp={215} onSave={vi.fn()} />
    );
    expect(screen.getByLabelText('CP de remo (vatios)')).toHaveValue(215);
    expect(
      screen.getByRole('button', { name: 'Guardar CP' })
    ).toBeInTheDocument();
  });
});
