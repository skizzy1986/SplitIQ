import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { render, screen } from '@testing-library/react';
import ProvenanceNote from '../ProvenanceNote.jsx';
import { THEME } from '../../../constants/theme.js';
import { seriesFromStrava } from '../../../utils/stravaSeries.js';
import { ACTIVITY_URL, stravaOkBody } from '../../../test/sessionFixtures.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('ProvenanceNote', () => {
  it('links an import to series.info.href with exactly "View on Strava", bold and underlined', () => {
    const series = seriesFromStrava(stravaOkBody({ n: 5 }));
    render(
      <ProvenanceNote
        source={series.source}
        href={series.info.href}
        origin={series.info.origin}
        measured={['power', 'hr', 'strokeRate']}
        derived={['pacePower', 'zonesCp', 'loadSrpe']}
      />
    );
    const link = screen.getByRole('link');
    expect(link.textContent).toBe('View on Strava');
    // The href is the server-built URL, passed through untouched.
    expect(link).toHaveAttribute('href', ACTIVITY_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.style.fontWeight).toBe('700');
    expect(link.style.textDecoration).toBe('underline');
    expect(link.style.color).toBe(THEME.accent);
    expect(screen.getByText(/^Imported from Strava\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Measured by the device: power, heart rate, stroke rate.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Derived here: pace from power, zones from your rowing CP anchor, load from your sRPE and duration.'
      )
    ).toBeInTheDocument();
  });

  it('renders no link without an href, and keeps the provenance line and caption', () => {
    render(
      <ProvenanceNote
        source="strava"
        href={null}
        origin="adopted"
        measured={['power']}
        derived={['loadSrpe']}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(
      screen.getByText('Summary from your log; trace from Strava.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Measured by the device: power.')
    ).toBeInTheDocument();
  });

  it('renders no link for an href that is not https', () => {
    for (const href of ['http://example.test/1', 'javascript:alert(1)', 42]) {
      const { unmount } = render(
        <ProvenanceNote source="strava" href={href} origin="inserted" />
      );
      expect(screen.queryByRole('link'), String(href)).toBeNull();
      unmount();
    }
  });

  it('names no source for an unknown one, and still captions what is measured', () => {
    render(
      <ProvenanceNote
        source="capture"
        href="https://example.test/1"
        measured={['power', 'hr']}
        derived={['loadPower']}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Summary from your log.')).toBeInTheDocument();
    expect(
      screen.getByText('Measured by the device: power, heart rate.')
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/strava/i);
  });

  it('types no colour hex, and neither it nor sourceCopy builds a URL', () => {
    const note = read('src/components/session/ProvenanceNote.jsx');
    const copy = read('src/components/session/sourceCopy.js');
    expect(note).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const src of [note, copy]) {
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/\.com\b/);
    }
  });
});
