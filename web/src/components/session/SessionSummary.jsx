import { useLingui } from '@lingui/react/macro';
import StatTile from '../StatTile.jsx';
import { THEME } from '../../constants/theme.js';
import { SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { formatClock } from '../../utils/sessionPage.js';
import { displayLogDate } from '../../utils/displayLocale.js';
import {
  bpmText,
  kmText,
  paceText,
  rateText,
  speedText,
  wattsText,
  withUnit,
} from './units.js';

const positive = (v) => typeof v === 'number' && v > 0;

// The stored summary, the load and how it was scored, and the numbers the
// series adds. A value that is absent renders no tile: never a zero, never a
// blank. The one zero shown on purpose is a load of 0, beside the reason.
//   summary: storedSummary(session, sport) · load: sessionLoadBasis(...)
//   extras: seriesExtras(series) or null · info: series.info or null
//   elapsedS: elapsed seconds from the series, or null
//   baseline: recentPowerBaseline(...) or null
export default function SessionSummary({
  session,
  sport,
  summary,
  load,
  extras = null,
  info = null,
  elapsedS = null,
  baseline = null,
}) {
  const { t, i18n } = useLingui();
  const tiles = [];
  const add = (key, label, value, detail) =>
    tiles.push({ key, label, value, detail });

  if (session.date) {
    add('date', t`Date`, displayLogDate(i18n.locale, session.date));
  }
  if (summary.minutes && session.duration) {
    add('duration', t`Duration`, String(session.duration));
  }
  if (positive(elapsedS)) add('elapsed', t`Elapsed`, formatClock(elapsedS));
  if (summary.distanceM)
    add('distance', t`Distance`, kmText(summary.distanceM));
  if (summary.avgWatts) {
    add('watts', t`Average power`, wattsText(summary.avgWatts));
  }
  if (summary.pace500) {
    add('pace', t`Average pace`, paceText(summary.pace500));
  }
  if (summary.speedKmh) {
    add('speed', t`Average speed`, speedText(summary.speedKmh));
  }
  if (summary.avgHr) {
    add('hr', t`Average heart rate`, bpmText(summary.avgHr));
  }
  if (summary.srpe) add('srpe', 'sRPE', String(summary.srpe));

  let basis;
  if (load.basis === 'srpe') {
    const srpe = session.srpe;
    basis = t`Scored from sRPE ${srpe} and the duration.`;
  } else if (load.basis === 'power') {
    const watts = Math.round(session.avg_watts);
    const threshold = Math.round(load.threshold);
    const factor = load.intensity.toFixed(2);
    basis =
      sport === 'cycling'
        ? t`Scored from average power ${watts} W against your bike FTP ${threshold} W (intensity ${factor}).`
        : t`Scored from average power ${watts} W against your rowing CP ${threshold} W (intensity ${factor}).`;
  } else if (load.reason === 'no_duration') {
    basis = t`Not scored: no duration is recorded.`;
  } else if (load.reason === 'no_watts') {
    basis = t`Not scored: no sRPE and no average power are recorded.`;
  } else if (load.reason === 'no_anchor') {
    basis =
      sport === 'cycling'
        ? t`Not scored: no sRPE, and no bike FTP anchor to measure power against.`
        : t`Not scored: no sRPE, and no rowing CP anchor to measure power against.`;
  } else {
    basis = t`Not scored: no sRPE, and this session type has no power model.`;
  }
  add('load', t`Load`, String(load.load), basis);

  if (extras) {
    if (positive(extras.workKj)) {
      add('work', t`Work`, withUnit(Math.round(extras.workKj), 'kJ'));
    }
    if (positive(extras.maxWatts)) {
      add('maxWatts', t`Max power`, wattsText(extras.maxWatts));
    }
    if (positive(extras.maxHr)) {
      add('maxHr', t`Max heart rate`, bpmText(extras.maxHr));
    }
    if (positive(extras.avgRate)) {
      add(
        'rate',
        sport === 'erg' ? t`Average stroke rate` : t`Average cadence`,
        rateText(extras.avgRate, sport)
      );
    }
  }
  if (info) {
    if (positive(info.elevationGainM)) {
      add(
        'elevation',
        t`Elevation gain`,
        withUnit(Math.round(info.elevationGainM), 'm')
      );
    }
    if (positive(info.calories)) {
      add('calories', t`Calories`, withUnit(Math.round(info.calories), 'kcal'));
    }
    if (typeof info.device === 'string' && info.device.trim()) {
      add('device', t`Device`, info.device.trim());
    }
  }

  const ownWatts = summary.avgWatts;
  let history = null;
  if (baseline && ownWatts) {
    const watts = Math.round(ownWatts);
    const mean = Math.round(baseline.meanWatts);
    const count = baseline.count;
    history =
      sport === 'cycling'
        ? t`Average power ${watts} W. Your rides in the 30 days before averaged ${mean} W across ${count} sessions.`
        : t`Average power ${watts} W. Your rowing sessions in the 30 days before averaged ${mean} W across ${count} sessions.`;
  }

  return (
    <section aria-label={t`Summary`}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: SPACE.sm,
        }}
      >
        {tiles.map(({ key, label, value, detail }) => (
          <div key={key} data-tile={key}>
            <StatTile label={label} value={value} detail={detail} />
          </div>
        ))}
      </div>
      {history && (
        <p
          style={{
            margin: `${SPACE.sm}px 0 0`,
            fontFamily: FONT.sans,
            fontSize: TYPE.bodySm.size,
            fontWeight: TYPE.bodySm.weight,
            color: THEME.textSubtle,
          }}
        >
          {history}
        </p>
      )}
    </section>
  );
}
