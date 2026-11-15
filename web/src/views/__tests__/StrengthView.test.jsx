import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const hookState = vi.fn();
vi.mock('../../hooks/useLiftHistory.js', () => ({
  useLiftHistory: () => hookState(),
}));

// Counts mounts in an effect, so a fresh instance per open is observable.
const loggerMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../StrengthLogger.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    default: function StrengthLoggerStub() {
      useEffect(() => {
        loggerMounts.count += 1;
      }, []);
      return <div>StrengthLogger-stub</div>;
    },
  };
});

import StrengthView from '../StrengthView.jsx';
import { DRAFT_KEY } from '../../utils/strengthDraft.js';

const strengthSessions = [
  {
    type: 'strength',
    label: 'Upper A',
    date: '1/9/01',
    exercises: ['Lift 3x5'],
  },
];

const loaded = (data) => ({ data, isPending: false, isError: false });

const lifts = {
  'Barbell Squat': [
    { date: '1/2/01', e1rm: 30 },
    { date: '1/9/01', e1rm: 35 },
  ],
  // Single data point → exercises the one-point branch when selected.
  'Lift B': [{ date: '1/2/01', e1rm: 20 }],
};

const renderView = () =>
  render(<StrengthView strengthSessions={strengthSessions} />);

const logButton = () => screen.getByRole('button', { name: 'Log a session' });

describe('StrengthView', () => {
  beforeEach(() => {
    hookState.mockReset();
    localStorage.clear();
    loggerMounts.count = 0;
  });

  it('renders the first lift trend and sessions', () => {
    hookState.mockReturnValue(loaded({ lifts, setCount: 3, scoredCount: 3 }));
    renderView();
    expect(
      screen.getByRole('button', { name: 'Barbell Squat' })
    ).toBeInTheDocument();
    expect(screen.getByText(/BARBELL SQUAT · e1RM/i)).toBeInTheDocument();
    expect(screen.getByText('35kg')).toBeInTheDocument();
    expect(screen.getByText(/current e1RM · 1\/9\/01/)).toBeInTheDocument();
    expect(screen.getByText('+5.0kg')).toBeInTheDocument();
    expect(screen.queryByText(/SAVED TEMPLATES/i)).toBeNull();
    expect(screen.queryByText(/Prehab/)).toBeNull();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });

  it('signs a falling trend correctly', () => {
    hookState.mockReturnValue(
      loaded({
        lifts: {
          'Lift C': [
            { date: '1/2/01', e1rm: 35 },
            { date: '1/9/01', e1rm: 30 },
          ],
        },
        setCount: 2,
        scoredCount: 2,
      })
    );
    renderView();
    expect(screen.getByText('-5.0kg')).toBeInTheDocument();
  });

  it('switches to a single-point lift and shows the one-point copy', () => {
    hookState.mockReturnValue(loaded({ lifts, setCount: 3, scoredCount: 3 }));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Lift B' }));
    expect(screen.getByText(/LIFT B · e1RM/i)).toBeInTheDocument();
    expect(screen.getByText(/One data point/i)).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });

  it('says nothing is logged when there are zero sets', () => {
    hookState.mockReturnValue(
      loaded({ lifts: {}, setCount: 0, scoredCount: 0 })
    );
    renderView();
    expect(
      screen.getByText('No strength sets logged yet.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/e1RM \(kg\)/)).not.toBeInTheDocument();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });

  it('says sets exist but none can be scored', () => {
    hookState.mockReturnValue(
      loaded({ lifts: {}, setCount: 2, scoredCount: 0 })
    );
    renderView();
    expect(
      screen.getByText(
        '2 sets logged — none with weight and reps to estimate e1RM.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No strength sets logged yet.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });

  it('shows a loading state while pending', () => {
    hookState.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderView();
    expect(screen.getByText('Loading strength history…')).toBeInTheDocument();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });

  it('shows an error state when the query fails', () => {
    hookState.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    renderView();
    expect(
      screen.getByText('Strength history unavailable.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No strength sets logged yet.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    expect(logButton()).toBeInTheDocument();
  });
});

// #520: the logger is reached from inside Strength, not from its own tab.
describe('StrengthView logging mode', () => {
  const validDraft = JSON.stringify({
    id: 'draft-1',
    label: 'Upper A',
    exercises: [{ name: 'Bench Press', sets: [] }],
  });

  beforeEach(() => {
    hookState.mockReset();
    hookState.mockReturnValue(loaded({ lifts, setCount: 3, scoredCount: 3 }));
    localStorage.clear();
    loggerMounts.count = 0;
  });

  const leave = () =>
    screen.getByRole('button', {
      name: 'Leave logger, back to strength trends',
    });

  it('opens the unchanged logger in place of the trends, and Leave returns focus', async () => {
    renderView();
    fireEvent.click(logButton());

    expect(await screen.findByText('StrengthLogger-stub')).toBeInTheDocument();
    expect(screen.queryByText(/BARBELL SQUAT · e1RM/i)).toBeNull();
    expect(screen.queryByText('STRENGTH SESSIONS')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log a session' })).toBeNull();
    expect(leave()).toHaveTextContent('← Leave logger');

    fireEvent.click(leave());
    expect(screen.queryByText('StrengthLogger-stub')).toBeNull();
    expect(screen.getByText(/BARBELL SQUAT · e1RM/i)).toBeInTheDocument();
    expect(screen.getByText('STRENGTH SESSIONS')).toBeInTheDocument();
    await waitFor(() => expect(logButton()).toHaveFocus());
  });

  it('reads "Resume session" when a valid draft is saved', () => {
    localStorage.setItem(DRAFT_KEY, validDraft);
    renderView();
    expect(
      screen.getByRole('button', { name: 'Resume session' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log a session' })).toBeNull();
  });

  it('mounts a fresh logger on every open and leaves the saved draft alone', async () => {
    localStorage.setItem(DRAFT_KEY, validDraft);
    renderView();
    const resume = () => screen.getByRole('button', { name: 'Resume session' });

    fireEvent.click(resume());
    await screen.findByText('StrengthLogger-stub');
    expect(loggerMounts.count).toBe(1);

    fireEvent.click(leave());
    fireEvent.click(resume());
    await screen.findByText('StrengthLogger-stub');
    expect(loggerMounts.count).toBe(2);

    expect(localStorage.getItem(DRAFT_KEY)).toBe(validDraft);
  });

  it('reads "Log a session" with no draft', () => {
    renderView();
    expect(logButton()).toBeInTheDocument();
  });

  it('reads "Log a session" when the draft is malformed', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: 'x' }));
    renderView();
    expect(logButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume session' })).toBeNull();
  });

  it('re-reads the draft on Leave, so a finished session relabels the button', async () => {
    localStorage.setItem(DRAFT_KEY, validDraft);
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    await screen.findByText('StrengthLogger-stub');

    // What the logger does on finish or discard.
    localStorage.removeItem(DRAFT_KEY);
    fireEvent.click(leave());

    expect(logButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume session' })).toBeNull();
  });

  it('moves focus to the Leave button when the logger opens', () => {
    renderView();
    fireEvent.click(logButton());
    expect(leave()).toHaveFocus();
  });

  it('does not focus the action button on first render', () => {
    renderView();
    expect(logButton()).not.toHaveFocus();
  });

  it('re-reads the draft on Leave, so a session started in the logger reads "Resume session"', async () => {
    renderView();
    fireEvent.click(logButton());
    await screen.findByText('StrengthLogger-stub');

    // What the logger does once a workout is under way.
    localStorage.setItem(DRAFT_KEY, validDraft);
    fireEvent.click(leave());

    expect(
      screen.getByRole('button', { name: 'Resume session' })
    ).toBeInTheDocument();
  });

  it('lets loadDraft remove a malformed draft on render', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: 'x' }));
    renderView();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
