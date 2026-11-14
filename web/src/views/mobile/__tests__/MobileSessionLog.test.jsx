import { fireEvent, render, screen } from '@testing-library/react';

const sessions = vi.fn();
vi.mock('../../../hooks/useSessions.js', () => ({
  useSessions: (...args) => sessions(...args),
}));
import MobileSessionLog from '../MobileSessionLog.jsx';

const row = (id, label, type, status) => ({
  id,
  label,
  type,
  status,
  date: '8/7/26',
});
beforeEach(() => sessions.mockReset());

it('requests complete history and renders rows beyond the old 50-session window', () => {
  sessions.mockReturnValue({
    data: Array.from({ length: 61 }, (_, i) =>
      row(i, `Session ${i}`, 'erg', 'completed')
    ),
    isLoading: false,
  });
  render(<MobileSessionLog />);
  expect(sessions).toHaveBeenCalledWith({ mode: 'all' });
  expect(screen.getByText('Session 60')).toBeInTheDocument();
  expect(screen.getByText('61 logged')).toBeInTheDocument();
});

it('shows cancelled history with a badge, excludes planned/Test, and counts completed statuses only', () => {
  sessions.mockReturnValue({
    data: [
      row(1, 'Actual erg', 'erg', 'actual'),
      row(2, 'Completed lift', 'strength', 'completed'),
      row(3, 'Saved erg', 'erg', 'logged'),
      row(4, 'Skipped erg', 'erg', 'cancelled'),
      row(5, 'Future erg', 'erg', 'planned'),
      row(6, 'Calibration test', 'Test', 'completed'),
    ],
    isLoading: false,
  });
  render(<MobileSessionLog />);
  expect(screen.getByText('3 logged')).toBeInTheDocument();
  expect(screen.getByText('Skipped erg')).toBeInTheDocument();
  expect(screen.getByText('Cancelled')).toBeInTheDocument();
  expect(screen.queryByText('Future erg')).toBeNull();
  expect(screen.queryByText('Calibration test')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Erg', exact: true }));
  expect(screen.getByText('2 logged')).toBeInTheDocument();
  expect(screen.queryByText('Completed lift')).toBeNull();
  expect(screen.getByText('Skipped erg')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Strength', exact: true })
  );
  expect(screen.getByText('1 logged')).toBeInTheDocument();
  expect(screen.getByText('Completed lift')).toBeInTheDocument();
  expect(screen.queryByText('Skipped erg')).toBeNull();
});

it('preserves raw types, metrics and labels while keeping the rowing-name filter', () => {
  sessions.mockReturnValue({
    data: [
      {
        ...row(1, 'Evening row', 'rowing', 'completed'),
        duration: 45,
        srpe: 6,
        avg_watts: 180,
      },
      { ...row(2, 'Bike ride', 'cycling', 'completed'), distance_m: 12000 },
      row(3, 'Upper strength', 'strength', 'cancelled'),
    ],
    isLoading: false,
  });
  render(<MobileSessionLog />);
  expect(screen.getByText('180w')).toBeInTheDocument();
  expect(screen.getByText('45 min')).toBeInTheDocument();
  expect(screen.getByText('RPE 6')).toBeInTheDocument();
  expect(screen.getByText('12.0km')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erg', exact: true }));
  expect(screen.getByText('Evening row')).toBeInTheDocument();
  expect(screen.queryByText('Bike ride')).toBeNull();
});

it('makes completed erg and cycling rows real links to their session page', () => {
  sessions.mockReturnValue({
    data: [
      row(11, 'Morning erg', 'erg', 'completed'),
      row(12, 'Club ride', 'ride', 'actual'),
      row(13, 'Upper strength', 'strength', 'completed'),
      row(14, 'Skipped erg', 'erg', 'cancelled'),
    ],
    isLoading: false,
  });
  render(<MobileSessionLog />);
  const erg = screen.getByRole('link', { name: /Morning erg/ });
  expect(erg).toHaveAttribute('href', '#/session/11');
  expect(erg).toHaveAttribute('data-session-link', '11');
  expect(erg.style.minHeight).toBe('44px');
  expect(screen.getByRole('link', { name: /Club ride/ })).toHaveAttribute(
    'href',
    '#/session/12'
  );
  expect(screen.getAllByRole('link')).toHaveLength(2);
});

it('shows an empty history when only planned sessions exist', () => {
  sessions.mockReturnValue({
    data: [row(1, 'Next week', 'erg', 'planned')],
    isLoading: false,
  });
  render(<MobileSessionLog />);
  expect(screen.getByText('0 logged')).toBeInTheDocument();
  expect(screen.getByText('No sessions found')).toBeInTheDocument();
  expect(screen.queryByText('Next week')).toBeNull();
});
