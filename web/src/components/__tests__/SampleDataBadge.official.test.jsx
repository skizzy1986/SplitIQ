import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SampleDataBadge from '../SampleDataBadge.jsx';

vi.mock('../../utils/testersBuild.js', () => ({
  isTestersBuild: () => false,
}));

describe('SampleDataBadge on the official build', () => {
  it('does not render, even when a row is flagged as sample', () => {
    render(<SampleDataBadge session={{ source: 'sample' }} locale="en" />);
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
    expect(screen.queryByText('Datos de ejemplo')).not.toBeInTheDocument();
  });
});
