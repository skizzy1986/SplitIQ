import { fireEvent, render, screen } from '@testing-library/react';
import MoreDetail from '../MoreDetail.jsx';
import { NBSP } from '../units.js';
import { spoken } from '../../../test/sessionFixtures.js';

const detail = (key) => document.querySelector(`[data-detail="${key}"]`);

const full = {
  peaks: [
    { windowS: 60, watts: 412.4, needs: null },
    { windowS: 300, watts: 305, needs: null },
    { windowS: 1200, watts: 251, needs: null },
  ],
  variability: { np: 238.6, avg: 221.2, vi: 1.0787 },
  drift: { firstRatio: 1.52, secondRatio: 1.46, driftPct: 3.94 },
  needs: { variability: null, drift: null },
};

const none = {
  peaks: [
    { windowS: 60, watts: 300, needs: null },
    { windowS: 300, watts: null, needs: 'duration' },
    { windowS: 1200, watts: null, needs: 'duration' },
  ],
  variability: null,
  drift: null,
  needs: { variability: 'duration', drift: 'duration' },
};

// Verdicts and instructions, which this panel never gives.
const VERDICT =
  /\b(good|poor|bad|great|excellent|should|must|try|aim|improve|too|better|worse|need to|keep)\b/i;

const toggle = () => screen.getByRole('button', { name: 'More detail' });

describe('MoreDetail', () => {
  it('starts collapsed, and the button controls the panel', () => {
    render(<MoreDetail {...full} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(
      toggle().getAttribute('aria-controls')
    );
    expect(panel).not.toBeVisible();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    fireEvent.click(toggle());
    expect(panel).not.toBeVisible();
  });

  it('shows each figure with a line on how it is derived', () => {
    render(<MoreDetail {...full} />);
    fireEvent.click(toggle());
    expect(detail('peak-60')).toHaveTextContent('Peak power, 1 min');
    expect(detail('peak-60').querySelector('dd').textContent).toBe(
      `412${NBSP}W`
    );
    expect(detail('peak-1200')).toHaveTextContent(
      'The highest average power over any stretch of that length in the elapsed time, a pause counting as 0 W.'
    );
    const value = (key) => detail(key).querySelector('dd').textContent;
    expect(value('weighted')).toBe(`239${NBSP}W`);
    expect(detail('weighted')).toHaveTextContent('fourth power');
    expect(value('variability')).toBe('1.08');
    expect(detail('variability')).toHaveTextContent(
      'Weighted power divided by the average power, 221 W.'
    );
    expect(value('drift')).toBe(`3.9${NBSP}%`);
    expect(detail('drift')).toHaveTextContent(
      '1.52 W/bpm in the first half of the moving time, 1.46 W/bpm in the second'
    );
    for (const key of ['weighted', 'variability', 'drift']) {
      expect(detail(key).querySelectorAll('dd')).toHaveLength(2);
    }
  });

  it('says what a figure needs instead of showing it', () => {
    render(<MoreDetail {...none} />);
    fireEvent.click(toggle());
    expect(detail('peak-300')).toHaveTextContent(
      'Needs a session at least 5 min long.'
    );
    expect(detail('weighted')).toHaveTextContent(
      'Needs at least 20 min of moving time.'
    );
    expect(detail('variability')).toHaveTextContent(
      'Needs at least 20 min of moving time.'
    );
  });

  it('names a missing reading', () => {
    render(
      <MoreDetail
        peaks={[{ windowS: 60, watts: null, needs: 'power' }]}
        needs={{ variability: 'power', drift: 'hr' }}
      />
    );
    fireEvent.click(toggle());
    expect(detail('peak-60')).toHaveTextContent('Needs a power reading.');
    expect(detail('weighted')).toHaveTextContent(
      'Needs a power reading for at least 80% of the moving time.'
    );
    expect(detail('drift')).toHaveTextContent(
      'Needs a heart rate reading for at least 80% of each half of the moving time.'
    );
  });

  it('describes; never judges or instructs', () => {
    for (const props of [full, none]) {
      const { container, unmount } = render(<MoreDetail {...props} />);
      fireEvent.click(toggle());
      expect(spoken(container)).not.toMatch(VERDICT);
      unmount();
    }
  });
});
