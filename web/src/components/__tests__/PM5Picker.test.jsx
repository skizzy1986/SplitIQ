import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PM5Picker from '../PM5Picker';

const MONITORS = [
  { id: 'AA', name: 'PM5 431719123 Row' },
  { id: 'BB', name: 'PM5 431719456 Row' },
  { id: 'CC', name: null },
];

function renderPicker(props = {}) {
  const handlers = {
    onChoose: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <PM5Picker
      monitors={MONITORS}
      phase="searching"
      connectingId={null}
      errorCode={null}
      locationOff={false}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('PM5Picker', () => {
  // AC1: rows carry the raw broadcast name.
  it('lists each monitor by its broadcast name, an unnamed one as Unnamed PM5', () => {
    renderPicker();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'PM5 431719123 Row',
      'PM5 431719456 Row',
      'Unnamed PM5',
    ]);
    expect(screen.getByText('Searching for PM5s…')).toBeInTheDocument();
  });

  it('is a labelled section with the heading focused', () => {
    renderPicker();
    const heading = screen.getByRole('heading', { name: 'Choose your PM5' });
    expect(document.activeElement).toBe(heading);
    expect(
      screen.getByRole('region', { name: 'Choose your PM5' })
    ).toBeInTheDocument();
  });

  // AC2
  it('tapping a row chooses that monitor', () => {
    const { onChoose } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'PM5 431719456 Row' }));
    expect(onChoose).toHaveBeenCalledWith('BB');
    fireEvent.click(screen.getByRole('button', { name: 'Unnamed PM5' }));
    expect(onChoose).toHaveBeenLastCalledWith('CC');
  });

  it('rows are at least 48 px tall', () => {
    renderPicker();
    for (const m of ['PM5 431719123 Row', 'Unnamed PM5']) {
      expect(screen.getByRole('button', { name: m }).style.minHeight).toBe(
        '48px'
      );
    }
  });

  it('marks the connecting row busy and disables the others', () => {
    renderPicker({ connectingId: 'BB' });
    const busy = screen.getByRole('button', { name: /PM5 431719456 Row/ });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Connecting…');
    expect(busy).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'PM5 431719123 Row' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unnamed PM5' })).toBeDisabled();
    expect(
      screen.getByText('Connecting to PM5 431719456 Row…')
    ).toBeInTheDocument();
  });

  it('puts status text in a polite live region', () => {
    renderPicker();
    expect(screen.getByText('Searching for PM5s…')).toHaveAttribute(
      'aria-live',
      'polite'
    );
  });

  it('shows the empty state with Try again when nothing was found', () => {
    const { onRetry } = renderPicker({ monitors: [], phase: 'empty' });
    expect(
      screen.getByText('No PM5 found nearby. Wake your monitor and try again.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the Location hint only in the empty state', () => {
    const hint = 'On Android 11 and older, Location must be on to find a PM5.';
    renderPicker({ monitors: [], phase: 'empty', locationOff: true });
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('hides the Location hint while searching or when Location is on', () => {
    const hint = /Location must be on/;
    const { unmount } = render(
      <PM5Picker
        monitors={[]}
        phase="searching"
        connectingId={null}
        errorCode={null}
        locationOff
        onChoose={() => {}}
        onRetry={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' })
    ).not.toBeInTheDocument();
    unmount();
    renderPicker({ monitors: [], phase: 'empty', locationOff: false });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it('Cancel and Escape both cancel', () => {
    const { onCancel } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('stops listening for Escape once closed', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <PM5Picker
        monitors={MONITORS}
        phase="searching"
        connectingId={null}
        errorCode={null}
        locationOff={false}
        onChoose={() => {}}
        onRetry={() => {}}
        onCancel={onCancel}
      />
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows a failed connect as an alert above the list', () => {
    renderPicker({ errorCode: 'PM5_CONNECT_FAILED' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't connect to that PM5. Check it's awake and not connected to another phone, then tap it again."
    );
  });

  it('shows a stale row disabled, in place, saying it is out of range', () => {
    const { onChoose } = renderPicker({
      monitors: [
        { id: 'AA', name: 'PM5 431719123 Row', stale: true },
        { id: 'BB', name: 'PM5 431719456 Row', stale: false },
      ],
    });
    const stale = screen.getByRole('button', { name: /PM5 431719123 Row/ });
    expect(stale).toBeDisabled();
    expect(stale).toHaveAttribute('aria-disabled', 'true');
    expect(stale).toHaveAccessibleName('PM5 431719123 Row Out of range');
    fireEvent.click(stale);
    expect(onChoose).not.toHaveBeenCalled();
    const live = screen.getByRole('button', { name: 'PM5 431719456 Row' });
    expect(live).toBeEnabled();
    expect(live).not.toHaveAttribute('aria-disabled');
    expect(screen.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      'PM5 431719123 RowOut of range',
      'PM5 431719456 Row',
    ]);
  });

  it('keeps row order and the same row elements when one goes stale and comes back', () => {
    const props = {
      phase: 'searching',
      connectingId: null,
      errorCode: null,
      locationOff: false,
      onChoose: () => {},
      onRetry: () => {},
      onCancel: () => {},
    };
    const rows = (stale) => [
      { id: 'AA', name: 'PM5 1 Row', stale: false },
      { id: 'BB', name: 'PM5 2 Row', stale },
      { id: 'CC', name: 'PM5 3 Row', stale: false },
    ];
    const { rerender } = render(
      <PM5Picker monitors={rows(false)} {...props} />
    );
    const before = screen.getAllByRole('button').slice(0, 3);
    rerender(<PM5Picker monitors={rows(true)} {...props} />);
    const during = screen.getAllByRole('button').slice(0, 3);
    expect(during).toEqual(before);
    during.forEach((b, i) => expect(b).toBe(before[i]));
    expect(during[1]).toBeDisabled();
    expect(screen.getByText('Out of range')).toBeInTheDocument();
    rerender(<PM5Picker monitors={rows(false)} {...props} />);
    const after = screen.getAllByRole('button').slice(0, 3);
    after.forEach((b, i) => expect(b).toBe(before[i]));
    expect(after[1]).toBeEnabled();
    expect(screen.queryByText('Out of range')).not.toBeInTheDocument();
  });

  it('the empty state replaces stale rows', () => {
    renderPicker({
      monitors: [{ id: 'AA', name: 'PM5 1 Row', stale: true }],
      phase: 'empty',
    });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(
      screen.getByText('No PM5 found nearby. Wake your monitor and try again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('shows no alert for an unknown code or none', () => {
    renderPicker({ errorCode: 'toString' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
