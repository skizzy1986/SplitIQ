import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnchorProvenance from '../AnchorProvenance.jsx';
import { CP_FORM } from '../../constants/cpFormCopy.js';

const live = {
  id: 'a3',
  value: '235',
  unit: 'W',
  source: 'test',
  valid_from: '2026-11-20',
  superseded_at: null,
  provenance: { protocol: '2k_6k' },
};
const retired = [
  {
    id: 'a2',
    value: '220',
    unit: 'W',
    source: 'manual',
    valid_from: '2026-11-01',
    superseded_at: '2026-11-20T00:00:00Z',
  },
];

describe('AnchorProvenance', () => {
  it('H5: origin, date and protocol at expert depth; nothing at simple depth', () => {
    const { container, rerender } = render(
      <AnchorProvenance
        copy={CP_FORM.en}
        depth="expert"
        live={live}
        retired={retired}
        lang="en"
      />
    );
    expect(screen.getByText('Where your CP comes from')).toBeInTheDocument();
    expect(screen.getByText('CP test')).toBeInTheDocument();
    expect(screen.getByText('20 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('2k + 6k test')).toBeInTheDocument();
    expect(screen.getByText('Earlier values')).toBeInTheDocument();
    expect(screen.getByText(/220 W/)).toBeInTheDocument();

    rerender(
      <AnchorProvenance
        copy={CP_FORM.en}
        depth="simple"
        live={live}
        retired={retired}
        lang="en"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('a typed-in CP has no protocol', () => {
    render(
      <AnchorProvenance
        copy={CP_FORM.en}
        depth="expert"
        live={{ ...live, source: 'manual', provenance: null }}
        lang="en"
      />
    );
    expect(screen.getByText('Typed in')).toBeInTheDocument();
    expect(screen.getByText('Not from a test')).toBeInTheDocument();
    expect(screen.queryByText('Earlier values')).toBeNull();
  });

  it('says so when there is no CP yet, and names an unknown source plainly', () => {
    const { rerender } = render(
      <AnchorProvenance copy={CP_FORM.en} depth="expert" live={null} />
    );
    expect(screen.getByText('No CP saved yet.')).toBeInTheDocument();
    rerender(
      <AnchorProvenance
        copy={CP_FORM.en}
        depth="expert"
        live={{ ...live, source: null }}
        lang="en"
      />
    );
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });

  it('shows the date day first for Spanish, from the calendar date', () => {
    render(
      <AnchorProvenance
        copy={CP_FORM.es}
        depth="expert"
        live={live}
        lang="es"
      />
    );
    expect(screen.getByText('Prueba de 2k + 6k')).toBeInTheDocument();
    expect(screen.getByText(/^20 .*2026$/)).toBeInTheDocument();
  });

  it('shows at most three earlier values', () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({
      ...retired[0],
      id: `r${n}`,
      value: String(200 + n),
    }));
    render(
      <AnchorProvenance
        copy={CP_FORM.en}
        depth="expert"
        live={live}
        retired={many}
        lang="en"
      />
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
