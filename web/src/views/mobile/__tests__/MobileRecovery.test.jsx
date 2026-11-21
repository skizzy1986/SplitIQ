import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MobileRecovery from '../MobileRecovery.jsx';

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

  describe('RHR / HRV tiles (#623)', () => {
    function renderWith(latestOverrides) {
      mockUseVitals.mockReturnValue({
        isLoading: false,
        latest: {
          rhr: 50,
          hrv: 60,
          sleep: 7.5,
          sleep_score: 85,
          ...latestOverrides,
        },
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
      mockUseTSSHistory.mockReturnValue({ data: [] });
      render(<MobileRecovery />);
    }

    const tileFor = (label) => screen.getByText(label).parentElement;
    const valueOf = (tile) => tile.children[1];

    function expectNoReading(tile) {
      expect(within(tile).getByText('No reading')).toBeInTheDocument();
      expect(valueOf(tile).style.color).toBe('var(--color-muted)');
      expect(within(tile).queryByText(/vs /)).not.toBeInTheDocument();
      expect(tile.textContent).not.toMatch(/[↑↓=]/);
    }

    it('rhr null: RHR tile reads "No reading", muted, no delta; HRV unaffected', () => {
      renderWith({ rhr: null });

      expectNoReading(tileFor('RESTING HR'));

      const hrv = tileFor('HRV');
      expect(valueOf(hrv).textContent).toBe('60 ms');
      expect(valueOf(hrv).style.color).toBe('var(--color-positive)');
      expect(within(hrv).getByText(/vs /)).toBeInTheDocument();
    });

    it('hrv null: HRV tile reads "No reading", muted, no delta; RHR unaffected', () => {
      renderWith({ hrv: null });

      expectNoReading(tileFor('HRV'));

      const rhr = tileFor('RESTING HR');
      expect(valueOf(rhr).textContent).toBe('50 bpm');
      expect(valueOf(rhr).style.color).toBe('var(--color-positive)');
      expect(rhr.textContent).toContain('=');
      expect(within(rhr).getByText(/vs /)).toBeInTheDocument();
    });

    it('both null: both tiles muted "No reading", no delta anywhere, hero still renders', () => {
      renderWith({ rhr: null, hrv: null });

      expectNoReading(tileFor('RESTING HR'));
      expectNoReading(tileFor('HRV'));
      expect(screen.queryByText(/vs /)).not.toBeInTheDocument();
      expect(screen.getByText('Train as planned')).toBeInTheDocument();
    });

    it('undefined readings are treated as missing, the same as null', () => {
      renderWith({ rhr: undefined, hrv: undefined });

      expectNoReading(tileFor('RESTING HR'));
      expectNoReading(tileFor('HRV'));
    });

    it.each([
      [50, '=', 'var(--color-positive)'],
      [54, '↑ +4', 'var(--color-caution)'],
      [57, '↑ +7', 'var(--color-critical)'],
      // Below baseline keeps the existing arrow-plus-sign format.
      [47, '↓ -3', 'var(--color-positive)'],
    ])('RHR %i renders "%s" with colour %s', (rhr, delta, colour) => {
      renderWith({ rhr });

      const tile = tileFor('RESTING HR');
      expect(valueOf(tile).textContent).toBe(`${rhr} bpm`);
      expect(valueOf(tile).style.color).toBe(colour);
      expect(tile.children[2].textContent).toContain(delta);
      expect(within(tile).getByText(/vs /)).toBeInTheDocument();
    });

    it.each([
      [60, '↑ +0', 'var(--color-positive)'],
      [55, '↓ 5', 'var(--color-caution)'],
      [50, '↓ 10', 'var(--color-critical)'],
      [65, '↑ +5', 'var(--color-positive)'],
    ])('HRV %i renders "%s" with colour %s', (hrv, delta, colour) => {
      renderWith({ hrv });

      const tile = tileFor('HRV');
      expect(valueOf(tile).textContent).toBe(`${hrv} ms`);
      expect(valueOf(tile).style.color).toBe(colour);
      expect(tile.children[2].textContent).toContain(delta);
      expect(within(tile).getByText(/vs /)).toBeInTheDocument();
    });
  });
});
