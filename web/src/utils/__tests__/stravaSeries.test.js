import { seriesFromStrava } from '../stravaSeries.js';
import { rangeStats } from '../sessionSeries.js';
import { ACTIVITY_URL, stravaOkBody } from '../../test/sessionFixtures.js';

describe('seriesFromStrava', () => {
  it('maps the response onto the neutral series', () => {
    const s = seriesFromStrava(stravaOkBody({ n: 10 }));
    expect(s.source).toBe('strava');
    expect(s.sampling).toBe('time');
    expect(s.n).toBe(10);
    expect(s.channels.hr[0]).toBe(130);
    expect(s.channels.rate[0]).toBe(22);
    expect(s.channels.dist[9]).toBe(36);
    expect(s.channels.speed[0]).toBe(4);
    expect(s.channels.moving[0]).toBe(true);
    expect(s.has).toEqual({
      power: true,
      hr: true,
      rate: true,
      distance: true,
    });
    expect(s.laps).toEqual([
      { i0: 0, i1: 9, elapsedS: 10, movingS: 10, distanceM: 40 },
    ]);
    expect(s.info).toEqual({
      elapsedS: 10,
      movingS: 10,
      distanceM: 40,
      elevationGainM: 0,
      calories: 300,
      device: 'Test Monitor',
      origin: 'inserted',
      ref: '987654',
      href: ACTIVITY_URL,
      fetchedAt: '2026-11-10T08:00:00Z',
    });
    expect(rangeStats(s, 'erg').avgWatts).toBe(170);
  });

  it('keeps the server-built url as info.href only when it is https', () => {
    const href = (url) =>
      seriesFromStrava({ ...stravaOkBody({ n: 3 }), url }).info.href;
    expect(href('https://activities.example.test/1')).toBe(
      'https://activities.example.test/1'
    );
    expect(href(undefined)).toBeNull();
    expect(href(null)).toBeNull();
    expect(href('http://activities.example.test/1')).toBeNull();
    expect(href('javascript:alert(1)')).toBeNull();
    expect(href('not a url')).toBeNull();
    expect(href(42)).toBeNull();
    expect(
      href({ toString: () => 'https://activities.example.test/1' })
    ).toBeNull();
  });

  it('keeps no power when the activity has no meter', () => {
    const body = stravaOkBody({ n: 5 });
    body.activity.device_watts = false;
    const s = seriesFromStrava(body);
    expect(s.channels.watts).toBeNull();
    expect(s.has.power).toBe(false);
  });

  it('maps a missing stream to an absent channel', () => {
    const s = seriesFromStrava(stravaOkBody({ n: 5, hr: false }));
    expect(s.channels.hr).toBeNull();
    expect(s.has.hr).toBe(false);
  });

  it('returns null when the activity has no streams', () => {
    expect(seriesFromStrava({ ...stravaOkBody(), streams: null })).toBeNull();
    expect(
      seriesFromStrava({ ...stravaOkBody(), streams: { time: [] } })
    ).toBeNull();
    expect(seriesFromStrava(null)).toBeNull();
  });

  it('throws on a stream whose length does not match time', () => {
    const body = stravaOkBody({ n: 5 });
    body.streams.watts = [1, 2];
    expect(() => seriesFromStrava(body)).toThrow();
  });
});
