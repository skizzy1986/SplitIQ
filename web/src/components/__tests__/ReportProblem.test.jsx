import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invokeMock = vi.fn();

vi.mock('../../supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...args) => invokeMock(...args) } },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import { version } from '../../../package.json';
import ReportProblem from '../ReportProblem.jsx';

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReportProblem />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  window.history.replaceState(null, '', '/#/settings?code=secret');
});

describe('ReportProblem', () => {
  it('opens a short form and sends the report without the query string', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByLabelText('What happened')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));

    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(
      screen.getByText('Describe what happened before sending.')
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText('What happened'),
      'The log did not save'
    );
    await user.type(
      screen.getByLabelText('Steps (optional)'),
      'Opened Train, then Log'
    );
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(
      await screen.findByText('Report sent. Thank you.')
    ).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('report-problem', {
      body: {
        what: 'The log did not save',
        steps: 'Opened Train, then Log',
        version,
        route: '/settings',
        platform: 'web',
      },
    });
    expect(JSON.stringify(invokeMock.mock.calls[0][1].body)).not.toContain(
      'secret'
    );
  });

  it('says when the report could not be sent, and when the limit is hit', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.type(screen.getByLabelText('What happened'), 'It froze');

    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { context: { status: 500 } },
    });
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(
      await screen.findByText('Could not send the report. Try again shortly.')
    ).toBeInTheDocument();

    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { context: { status: 429 } },
    });
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(
      await screen.findByText(
        'Too many reports in a short time. Try again later.'
      )
    ).toBeInTheDocument();
  });

  it('closes again from Cancel', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Report a problem' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('What happened')).toBeNull();
  });
});
