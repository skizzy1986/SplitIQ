import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { formatClock } from '../../utils/sessionPage.js';
import {
  bpmText,
  distanceText,
  paceText,
  rateText,
  speedText,
  wattsText,
} from './units.js';

const positive = (v) => typeof v === 'number' && v > 0;

const buttonStyle = {
  minHeight: 44,
  padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.pill,
  border: `1px solid ${THEME.border}`,
  background: THEME.surface,
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  cursor: 'pointer',
};

// What happened over a selected stretch of the session: a dragged range of
// the trace or a split. An absent value is left out, never shown as zero.
//   stats: rangeStats(...) or a split, which has the same fields
//   sport: 'erg' | 'cycling' · onClear: back to the whole session
export default function RangeSummary({ stats, sport, onClear }) {
  const { t } = useLingui();
  const items = [];
  const add = (key, label, value) => items.push({ key, label, value });
  if (positive(stats.movingS)) {
    add('moving', t`Moving time`, formatClock(stats.movingS));
  }
  if (positive(stats.elapsedS)) {
    add('elapsed', t`Elapsed`, formatClock(stats.elapsedS));
  }
  if (positive(stats.distanceM)) {
    add('distance', t`Distance`, distanceText(stats.distanceM));
  }
  if (positive(stats.avgWatts)) {
    add('watts', t`Average power`, wattsText(stats.avgWatts));
  }
  if (sport === 'erg' && positive(stats.pace500)) {
    add('pace', t`Average pace`, paceText(stats.pace500));
  }
  if (sport === 'cycling' && positive(stats.speedKmh)) {
    add('speed', t`Average speed`, speedText(stats.speedKmh));
  }
  if (positive(stats.avgHr)) {
    add('hr', t`Average heart rate`, bpmText(stats.avgHr));
  }
  if (positive(stats.avgRate)) {
    add(
      'rate',
      sport === 'erg' ? t`Average stroke rate` : t`Average cadence`,
      rateText(stats.avgRate, sport)
    );
  }
  return (
    <section
      aria-label={t`Selected range`}
      style={{
        margin: `${SPACE.sm}px 0 ${SPACE.md}px`,
        padding: SPACE.md,
        borderRadius: RADIUS.md,
        border: `1px solid ${THEME.border}`,
        background: THEME.raised,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SPACE.sm,
          marginBottom: SPACE.sm,
        }}
      >
        <span
          style={{
            fontSize: TYPE.body.size,
            fontWeight: TYPE.label.weight,
            color: THEME.text,
          }}
        >
          {t`Selected range`}
        </span>
        <button type="button" onClick={onClear} style={buttonStyle}>
          {t({ message: 'Clear', comment: 'Button: clear the selected range' })}
        </button>
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: SPACE.sm,
          margin: 0,
        }}
      >
        {items.map(({ key, label, value }) => (
          <div key={key} data-range={key}>
            <dt
              style={{
                fontSize: TYPE.label.size,
                fontWeight: TYPE.label.weight,
                color: THEME.textFaint,
              }}
            >
              {label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontFamily: FONT.mono,
                fontSize: TYPE.body.size,
                fontWeight: TYPE.label.weight,
                color: THEME.text,
              }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
