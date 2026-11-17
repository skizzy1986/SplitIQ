import { render, screen, within } from '@testing-library/react';
import SessionSummary from '../SessionSummary.jsx';
import { storedSummary } from '../../../utils/sessionPage.js';
import { sessionLoadBasis } from '../../../utils/trainingLoad.js';
import { ergRow } from '../../../test/sessionFixtures.js';

const ANCHORS = { cp: 200, ftp: 250 };

function renderSummary(session, sport = 'erg', props = {}) {
  return render(
    <SessionSummary
      session={session}
      sport={sport}
      summary={storedSummary(session, sport)}
      load={sessionLoadBasis(session, ANCHORS)}
      {...props}
    />
  );
}

const tile = (key) => document.querySelector(`[data-tile="${key}"]`);

describe('SessionSummary', () => {
  it('shows the stored summary and the load with its sRPE basis', () => {
    renderSummary(ergRow());
    expect(tile('date')).toHaveTextContent('11/10/26');
    expect(tile('duration')).toHaveTextContent('30:00');
    expect(tile('distance')).toHaveTextContent('7.20 km');
    expect(tile('watts')).toHaveTextContent('180 W');
    expect(tile('pace')).toHaveTextContent('2:05.0 /500 m');
    expect(tile('hr')).toHaveTextContent('140 bpm');
    expect(tile('srpe')).toHaveTextContent('5');
    expect(tile('load')).toHaveTextContent('25');
    expect(
      within(tile('load')).getByText('Scored from sRPE 5 and the duration.')
    ).toBeInTheDocument();
  });

  it('says power scored the session, against CP or FTP', () => {
    renderSummary(ergRow({ srpe: null, avg_watts: 200 }));
    expect(
      screen.getByText(
        'Scored from average power 200 W against your rowing CP 200 W (intensity 1.00).'
      )
    ).toBeInTheDocument();
  });

  it('says why the load is zero', () => {
    renderSummary(ergRow({ srpe: null, avg_watts: null }));
    expect(tile('load')).toHaveTextContent('0');
    expect(
      screen.getByText('Not scored: no sRPE and no average power are recorded.')
    ).toBeInTheDocument();
  });

  it.each([
    [
      'no_duration',
      ergRow({ duration: null, srpe: null }),
      'erg',
      'Not scored: no duration is recorded.',
    ],
    [
      'no_anchor (rowing)',
      ergRow({ srpe: null, avg_watts: 180 }),
      'erg',
      'Not scored: no sRPE, and no rowing CP anchor to measure power against.',
      { cp: null, ftp: 250 },
    ],
    [
      'no_anchor (cycling)',
      ergRow({ type: 'cycling', srpe: null, avg_watts: 180 }),
      'cycling',
      'Not scored: no sRPE, and no bike FTP anchor to measure power against.',
      { cp: 200, ftp: null },
    ],
    [
      'no_power_model',
      ergRow({ type: 'strength', srpe: null }),
      'erg',
      'Not scored: no sRPE, and this session type has no power model.',
    ],
    [
      'power against bike FTP',
      ergRow({ type: 'cycling', srpe: null, avg_watts: 200 }),
      'cycling',
      'Scored from average power 200 W against your bike FTP 250 W (intensity 0.80).',
    ],
  ])('words the load basis: %s', (_name, session, sport, text, anchors) => {
    render(
      <SessionSummary
        session={session}
        sport={sport}
        summary={storedSummary(session, sport)}
        load={sessionLoadBasis(session, anchors ?? ANCHORS)}
      />
    );
    expect(within(tile('load')).getByText(text)).toBeInTheDocument();
  });

  it('shows cycling speed, not pace', () => {
    renderSummary(
      ergRow({ type: 'cycling', duration: '60:00', distance_m: 30000 }),
      'cycling'
    );
    expect(tile('speed')).toHaveTextContent('30.0 km/h');
    expect(tile('pace')).toBeNull();
  });

  it('shows the extras the series adds', () => {
    renderSummary(ergRow(), 'erg', {
      extras: { maxWatts: 310, maxHr: 171, avgRate: 23.6, workKj: 324.4 },
      info: { elevationGainM: 12, calories: 280, device: 'Test Monitor' },
      elapsedS: 1830,
    });
    expect(tile('elapsed')).toHaveTextContent('30:30');
    expect(tile('work')).toHaveTextContent('324 kJ');
    expect(tile('maxWatts')).toHaveTextContent('310 W');
    expect(tile('maxHr')).toHaveTextContent('171 bpm');
    expect(tile('rate')).toHaveTextContent('24 spm');
    expect(tile('elevation')).toHaveTextContent('12 m');
    expect(tile('calories')).toHaveTextContent('280 kcal');
    expect(tile('device')).toHaveTextContent('Test Monitor');
  });

  it('renders no tile, no zero and no blank for an absent value', () => {
    renderSummary(
      ergRow({
        distance_m: null,
        avg_watts: null,
        avg_hr: null,
        srpe: null,
        duration: '20:00',
      }),
      'erg',
      {
        extras: { maxWatts: null, maxHr: null, avgRate: null, workKj: null },
        info: { elevationGainM: 0, calories: null, device: '  ' },
        elapsedS: null,
      }
    );
    for (const key of [
      'distance',
      'watts',
      'pace',
      'hr',
      'srpe',
      'elapsed',
      'work',
      'maxWatts',
      'maxHr',
      'rate',
      'elevation',
      'calories',
      'device',
    ]) {
      expect(tile(key), key).toBeNull();
    }
    const tiles = [...document.querySelectorAll('[data-tile]')];
    expect(tiles.map((t) => t.dataset.tile)).toEqual([
      'date',
      'duration',
      'load',
    ]);
    // The load's zero is the one zero on purpose, and it carries its reason.
    for (const t of tiles) {
      expect(t.textContent.trim()).not.toBe('');
      if (t.dataset.tile !== 'load')
        expect(t.textContent).not.toMatch(/^\D*0\D*$/);
    }
  });

  it('grounds average power in the athlete’s own recent history', () => {
    renderSummary(ergRow(), 'erg', {
      baseline: { meanWatts: 172.4, count: 6 },
    });
    expect(
      screen.getByText(
        'Average power 180 W. Your rowing sessions in the 30 days before averaged 172 W across 6 sessions.'
      )
    ).toBeInTheDocument();
  });
});
