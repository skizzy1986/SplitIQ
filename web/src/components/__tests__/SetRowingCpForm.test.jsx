import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SetRowingCpForm from '../SetRowingCpForm.jsx';
import { CP_FORM } from '../../constants/cpFormCopy.js';

const rpcMock = vi.fn();
const fromMock = vi.fn(() => {
  throw new Error('the form must not write anchors directly');
});

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args),
  },
}));

function setup(currentCp = 215) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <SetRowingCpForm copy={CP_FORM.en} currentCp={currentCp} />
    </QueryClientProvider>
  );
  const input = screen.getByLabelText('Rowing CP (watts)');
  return { input, invalidate };
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

// Gate 1 criterion 9 (#797): a failed save says so and keeps the old CP.
describe('SetRowingCpForm', () => {
  it('criterion 9: a failed save shows "Could not save that. Try again." and keeps the old CP', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'not found' },
    });
    const { input, invalidate } = setup(215);
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save that. Try again.'
    );
    expect(rpcMock).toHaveBeenCalledWith('set_my_rowing_cp', { p_watts: 230 });
    expect(fromMock).not.toHaveBeenCalled();
    // Nothing refetched, so the CP shown elsewhere stays the old one.
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a successful save confirms it and refreshes the CP', async () => {
    rpcMock.mockResolvedValue({
      data: { status: 'saved', watts: 230, replaced: true },
      error: null,
    });
    const { input, invalidate } = setup(215);
    fireEvent.change(input, { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save CP' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rowing CP saved.'
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['anchors'] });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
