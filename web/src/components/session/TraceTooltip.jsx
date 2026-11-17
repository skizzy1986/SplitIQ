import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { formatPace } from '../../utils/pace.js';
import { formatClock } from '../../utils/sessionPage.js';

// The tooltip of one chart. With syncId every chart shows its own tooltip at
// the hovered instant, so each shows the time and its own series (pace and
// power together on the first chart); the three together show every value
// once. Recharts hands a custom `content` the active state, the hovered index
// and the payload (Context7 /recharts/recharts, TooltipContentProps); the row
// comes from the shared rows array by index, falling back to the payload's.
//   chart: 'first' | 'hr' | 'rate'; omitted, every series is shown
export default function TraceTooltip({
  active,
  activeIndex,
  payload,
  rows = [],
  sport,
  has = {},
  chart = null,
}) {
  const { t } = useLingui();
  if (!active) return null;
  const index = Number(activeIndex);
  const row =
    (Number.isInteger(index) ? rows[index] : null) ??
    payload?.[0]?.payload ??
    null;
  if (!row) return null;
  const on = (which) => chart == null || chart === which;
  // A ride without power has no first chart; its speed rides on heart rate's.
  const speedChart = sport === 'cycling' && !has.power ? 'hr' : 'first';
  const lines = [];
  if (on('first') && sport === 'erg' && row.pace != null) {
    lines.push(['pace', t`Pace`, `${formatPace(row.pace)} /500 m`]);
  }
  if (on(speedChart) && sport === 'cycling' && row.speed != null) {
    lines.push(['speed', t`Speed`, `${(row.speed * 3.6).toFixed(1)} km/h`]);
  }
  if (on('first') && has.power && row.watts != null) {
    lines.push(['watts', t`Power`, `${Math.round(row.watts)} W`]);
  }
  if (on('hr') && has.hr && row.hr != null) {
    lines.push(['hr', t`Heart rate`, `${Math.round(row.hr)} bpm`]);
  }
  if (on('rate') && has.rate && row.rate != null) {
    lines.push([
      'rate',
      sport === 'erg' ? t`Stroke rate` : t`Cadence`,
      `${Math.round(row.rate)} ${sport === 'erg' ? 'spm' : 'rpm'}`,
    ]);
  }
  return (
    <div
      style={{
        background: THEME.raised,
        border: `1px solid ${THEME.border}`,
        borderRadius: RADIUS.sm,
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        fontFamily: FONT.mono,
        fontSize: TYPE.label.size,
        color: THEME.text,
      }}
    >
      <div
        style={{
          color: THEME.muted,
          fontSize: TYPE.micro.size,
          marginBottom: SPACE.xs,
        }}
      >
        {formatClock(row.x)}
      </div>
      {lines.length === 0 ? (
        <div style={{ color: THEME.muted }}>
          {t({
            message: 'No reading at this moment',
            comment: 'Trace tooltip over a gap',
          })}
        </div>
      ) : (
        lines.map(([key, label, value]) => (
          <div key={key} style={{ display: 'flex', gap: SPACE.sm }}>
            <span style={{ color: THEME.muted, fontFamily: FONT.sans }}>
              {label}
            </span>
            <span style={{ fontWeight: 700 }}>{value}</span>
          </div>
        ))
      )}
    </div>
  );
}
