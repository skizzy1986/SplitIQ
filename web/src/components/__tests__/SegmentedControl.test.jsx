import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SegmentedControl from '../SegmentedControl.jsx';

const ITEMS = [
  { id: 'load', label: 'Load' },
  { id: 'erg', label: 'Erg' },
];

describe('SegmentedControl', () => {
  // Tab roles promise arrow-key behaviour and tab panels this control does not
  // have, so it is a labelled nav of buttons with aria-current (#611 review).
  it('is a labelled navigation of buttons, not an ARIA tabs widget', () => {
    render(
      <SegmentedControl
        label="Sections"
        items={ITEMS}
        value="erg"
        onChange={() => {}}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Load', 'Erg']);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('button', { name: 'Erg' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: 'Load' })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('reports the chosen item', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Sections"
        items={ITEMS}
        value="load"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Erg' }));
    expect(onChange).toHaveBeenCalledWith('erg');
  });
});
