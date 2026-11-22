import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getUser = vi.fn();
const invoke = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('../../supabaseClient.js', () => ({
  supabase: {
    auth: { getUser: (...args) => getUser(...args) },
    functions: { invoke: (...args) => invoke(...args) },
  },
}));

import ReportProblem from '../ReportProblem.jsx';

const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  getUser.mockReset();
  invoke.mockReset();
  window.history.replaceState(null, '', '/#/settings');
  getUser.mockResolvedValue({
    data: { user: { id: USER, email: 'person@example.com' } },
    error: null,
  });
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('ReportProblem', () => {
  it('opens a short form from Settings', async () => {
    const user = userEvent.setup();
    render(<ReportProblem />);
    expect(screen.queryByLabelText('What happened')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(screen.getByLabelText('What happened')).toBeInTheDocument();
    expect(screen.getByLabelText('Steps (optional)')).toBeInTheDocument();
  });

  it('asks for what happened before sending', async () => {
    const user = userEvent.setup();
    render(<ReportProblem />);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Describe what happened.'
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the report, version, route, platform and user id, not the email', async () => {
    const user = userEvent.setup();
    render(<ReportProblem />);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.type(
      screen.getByLabelText('What happened'),
      'The chart is blank'
    );
    await user.type(screen.getByLabelText('Steps (optional)'), 'Open Today');
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent. Thank you.'
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, { body }] = invoke.mock.calls[0];
    expect(name).toBe('report-problem');
    expect(body).toEqual({
      what: 'The chart is blank',
      steps: 'Open Today',
      version: '1.3.0',
      route: '#/settings',
      platform: 'web',
      userId: USER,
    });
    expect(JSON.stringify(body)).not.toContain('person@example.com');
    expect(JSON.stringify(body)).not.toContain('hooks.slack.com');
  });

  it('says when the report was not accepted', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: { status: 429 },
        message: 'https://hooks.example/secret',
      },
    });
    const user = userEvent.setup();
    render(<ReportProblem />);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.type(screen.getByLabelText('What happened'), 'It froze');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Too many reports. Try again shortly.'
    );
    expect(screen.queryByText(/hooks\.example/)).toBeNull();
  });
});
