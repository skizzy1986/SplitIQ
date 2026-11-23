import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import MobileRecovery from '../MobileRecovery.jsx';
import { THEME } from '../../../constants/theme.js';

const mockUseVitals = vi.fn();
const mockUseVitalsSync = vi.fn();
const mockUseTSSHistory = vi.fn();

vi.mock('../../../hooks/useVitals.js', () => ({
  useVitals: () => mockUseVitals(),
}));
vi.mock('../../../hooks/useVitalsSync.js', () => ({
  useVitalsSync: () => mockUseVitalsSync(),
}));
vi.mock('../../../hooks/useTSSHistory.js', () => ({
  useTSSHistory: () => mockUseTSSHistory(),
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    LineChart: ({ children }) => <div>{children}</div>,
    Line: ({ dataKey, stroke }) => (
      <div data-testid={`series-${dataKey}`} data-stroke={stroke} />
    ),
  };
});

beforeEach(() => {
  mockUseVitals.mockReset();
  mockUseVitalsSync.mockReset();
  mockUseTSSHistory.mockReset();
});

describe('MobileRecovery', () => {
  it('renders a finite TSB from calcTrainingLoad with same-day aggregated entries', () => {
    mockUseVitals.mockReturnValue({
      isLoading: false,
      latest: { rhr: 50, hrv: 60, sleep: 7.5, sleep_score: null },
      readinessScore: 82,
      readinessLabel: 'READY',
      personalBaselines: { rhrBaseline: 50, hrvBaseline: 60 },
      vitalsHistory: [],
      history: [],
      hasPersonalBaselines: false,
    });
    mockUseVitalsSync.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockUseTSSHistory.mockReturnValue({
      data: [
        { date: '2026-06-13', tss: 30 },
        { date: '2026-06-13', tss: 20 },
      ],
    });

    render(<MobileRecovery />);

    // FORM / TSB tile shows because sleep_score is null
    const tsbTile = screen.getByText('FORM / TSB');
    expect(tsbTile).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();

    // the rendered TSB value is a finite one-decimal number
    const value = tsbTile.parentElement.querySelector('div:last-child');
    expect(Number.isNaN(parseFloat(value.textContent))).toBe(false);
  });

  function renderSettled(over = {}) {
    mockUseVitals.mockReturnValue({
      isLoading: false,
      latest: { rhr: 50, hrv: 60, sleep: 7.5, sleep_score: null },
      readinessScore: 82,
      readinessLabel: 'READY',
      personalBaselines: { rhrBaseline: 50, hrvBaseline: 60 },
      vitalsHistory: [],
      history: [{ date: '2026-06-20', readinessScore: 80 }],
      hasPersonalBaselines: false,
      ...over,
    });
    mockUseVitalsSync.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockUseTSSHistory.mockReturnValue({ data: [] });
    render(<MobileRecovery />);
  }

  it('does not derive a delta or a status colour from a missing RHR or HRV', () => {
    renderSettled({
      latest: { rhr: null, hrv: null, sleep: 7.5, sleep_score: null },
      personalBaselines: { rhrBaseline: 50, hrvBaseline: 60 },
    });
    for (const label of ['RESTING HR', 'HRV']) {
      const tile = screen.getByText(label).parentElement;
      expect(within(tile).getByText('No reading').style.color).toBe(
        THEME.muted
      );
      expect(within(tile).queryByText(/[↑↓=]/)).not.toBeInTheDocument();
      expect(within(tile).queryByText(/vs /)).not.toBeInTheDocument();
    }
  });

  it('still colours a present RHR and HRV against the baseline', () => {
    renderSettled({
      latest: { rhr: 58, hrv: 50, sleep: 7.5, sleep_score: null },
      personalBaselines: { rhrBaseline: 50, hrvBaseline: 60 },
    });
    const rhr = screen.getByText('RESTING HR').parentElement;
    expect(within(rhr).getByText('58 bpm').style.color).toBe(THEME.critical);
    expect(within(rhr).getByText(/↑ \+8/)).toBeInTheDocument();
    const hrv = screen.getByText('HRV').parentElement;
    expect(within(hrv).getByText('50 ms').style.color).toBe(THEME.critical);
    expect(within(hrv).getByText(/↓ 10/)).toBeInTheDocument();
  });

  it('shows a missing sleep reading with no status line', () => {
    renderSettled({
      latest: { rhr: 50, hrv: 60, sleep: null, sleep_score: null },
    });
    const tile = screen.getByText('SLEEP').parentElement;
    expect(within(tile).getByText('No reading').style.color).toBe(THEME.muted);
    expect(within(tile).queryByText('Below 7h target')).not.toBeInTheDocument();
    expect(within(tile).queryByText('Target met')).not.toBeInTheDocument();
  });

  it('keeps a present sleep reading’s status', () => {
    renderSettled();
    const met = screen.getByText('SLEEP').parentElement;
    expect(within(met).getByText('7.5h').style.color).toBe(THEME.positive);
    expect(within(met).getByText('Target met')).toBeInTheDocument();

    cleanup();
    renderSettled({
      latest: { rhr: 50, hrv: 60, sleep: 6, sleep_score: null },
    });
    const low = screen.getByText('SLEEP').parentElement;
    expect(within(low).getByText('6h').style.color).toBe(THEME.critical);
    expect(within(low).getByText('Below 7h target')).toBeInTheDocument();
  });

  it('shows a null readiness score as no reading, and a fixed chart colour', () => {
    renderSettled({ readinessScore: null, readinessLabel: 'NO DATA' });
    const score = screen.getByText('READINESS').previousElementSibling;
    expect(score).toHaveTextContent('No reading');
    expect(score.style.color).toBe(THEME.muted);
    expect(
      screen.queryByText('Prioritise recovery today')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Train as planned')).not.toBeInTheDocument();
    expect(screen.getByTestId('series-readinessScore')).toHaveAttribute(
      'data-stroke',
      THEME.accent
    );
  });
});
