import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { formatPace, wattsToPace500 } from '../../utils/pace.js';
import { formatClock } from '../../utils/sessionPage.js';
import TraceTooltip from './TraceTooltip.jsx';

// One sync group per page: one hover drives all three charts. Synchronisation
// is by index by default, so the charts must share one rows array (Context7
// /recharts/recharts, syncId / syncMethod).
const SYNC_ID = 'session-trace';

const tick = { fontSize: 9, fill: THEME.muted, fontFamily: FONT.mono };

// Bounds from the data, padded so no line touches an edge.
function domainOf(rows, key) {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const v = r[key];
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return null;
  const pad = Math.max((max - min) * 0.05, 2);
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

// Zone bands in the first chart's units, clipped to its domain. Rowing bands
// are drawn in pace (a higher watt bound is a faster pace), cycling in watts.
// The top band is open-ended.
function bandsFor(zones, sport, domain) {
  if (!zones || !domain) return [];
  const [lo, hi] = domain;
  const last = zones.length - 1;
  return zones
    .map((z, k) => {
      let y1;
      let y2;
      if (sport === 'erg') {
        y1 = k < last && z.wattsHigh > 0 ? wattsToPace500(z.wattsHigh) : lo;
        y2 = z.wattsLow > 0 ? wattsToPace500(z.wattsLow) : hi;
      } else {
        y1 = z.wattsLow;
        y2 = k < last && z.wattsHigh != null ? z.wattsHigh : hi;
      }
      return {
        key: z.key ?? z.zone,
        color: z.color,
        y1: Math.max(lo, Math.min(y1, y2)),
        y2: Math.min(hi, Math.max(y1, y2)),
      };
    })
    .filter((b) => b.y2 > b.y1);
}

const missingStyle = {
  margin: `${SPACE.sm}px 0`,
  fontFamily: FONT.sans,
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.bodySm.weight,
  color: THEME.textSubtle,
};

function Chart({
  rows,
  dataKey,
  color,
  domain,
  reversed,
  format,
  unit,
  label,
  height,
  tooltip,
  bands = [],
  average = null,
}) {
  return (
    <div role="img" aria-label={label} style={{ marginBottom: SPACE.sm }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={rows}
          syncId={SYNC_ID}
          margin={{ top: 8, right: 20, left: 4, bottom: 0 }}
        >
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, 'dataMax']}
            tickFormatter={formatClock}
            tick={tick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            reversed={reversed}
            tickFormatter={format}
            tick={tick}
            axisLine={false}
            tickLine={false}
            width={64}
            label={{
              value: unit,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
              fill: THEME.muted,
            }}
          />
          {bands.map((b) => (
            <ReferenceArea
              key={b.key}
              y1={b.y1}
              y2={b.y2}
              fill={b.color}
              fillOpacity={0.08}
              ifOverflow="hidden"
            />
          ))}
          {average != null && (
            <ReferenceLine
              y={average}
              stroke={THEME.textSubtle}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          )}
          <Tooltip content={tooltip} isAnimationActive={false} />
          <Line
            type="linear"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// The session's trace: up to three stacked charts over the same time axis —
// pace (rowing) or power (cycling), heart rate, stroke rate or cadence. A
// channel the series lacks draws no chart and one line says so.
//   rows: downsample(series, sport) · has: series.has · zones: the derived
//   bands or null · average: the session average in chart 1's units, or null
export default function SessionTrace({
  rows,
  sport,
  has,
  zones = null,
  average = null,
  durationS = null,
  layout = 'desktop',
}) {
  const { t } = useLingui();
  const height = layout === 'phone' ? 120 : 150;
  const tooltip = <TraceTooltip rows={rows} sport={sport} has={has} />;
  const over = formatClock(durationS ?? rows.at(-1)?.x ?? 0);
  const out = [];

  const firstKey = sport === 'erg' ? 'pace' : 'watts';
  const firstDomain =
    sport === 'erg' || has.power ? domainOf(rows, firstKey) : null;
  if (firstDomain && sport === 'erg') {
    const fast = formatPace(firstDomain[0]);
    const slow = formatPace(firstDomain[1]);
    const avg = average != null ? formatPace(average) : null;
    out.push(
      <Chart
        key="pace"
        rows={rows}
        dataKey="pace"
        color={THEME.accent}
        domain={firstDomain}
        reversed
        format={formatPace}
        unit="/500 m"
        label={
          avg
            ? t`Pace across ${over}, between ${fast} and ${slow} per 500 m; average ${avg}.`
            : t`Pace across ${over}, between ${fast} and ${slow} per 500 m.`
        }
        height={height}
        tooltip={tooltip}
        bands={bandsFor(zones, sport, firstDomain)}
        average={average}
      />
    );
  } else if (firstDomain) {
    const [lo, hi] = firstDomain;
    const avg = average != null ? Math.round(average) : null;
    out.push(
      <Chart
        key="watts"
        rows={rows}
        dataKey="watts"
        color={THEME.cycling}
        domain={firstDomain}
        format={(v) => `${Math.round(v)}`}
        unit="W"
        label={
          avg != null
            ? t`Power across ${over}, between ${lo} and ${hi} W; average ${avg} W.`
            : t`Power across ${over}, between ${lo} and ${hi} W.`
        }
        height={height}
        tooltip={tooltip}
        bands={bandsFor(zones, sport, firstDomain)}
        average={average}
      />
    );
  } else {
    out.push(
      <p key="no-first" style={missingStyle}>
        {sport === 'erg'
          ? t`No power or speed was recorded, so there is no pace trace.`
          : t`No power was recorded on this ride, so there is no power trace and no zones.`}
      </p>
    );
  }

  const hrDomain = has.hr ? domainOf(rows, 'hr') : null;
  if (hrDomain) {
    const [lo, hi] = hrDomain;
    out.push(
      <Chart
        key="hr"
        rows={rows}
        dataKey="hr"
        color={THEME.critical}
        domain={hrDomain}
        format={(v) => `${Math.round(v)}`}
        unit="bpm"
        label={t`Heart rate across ${over}, between ${lo} and ${hi} bpm.`}
        height={height}
        tooltip={tooltip}
      />
    );
  } else {
    out.push(
      <p key="no-hr" style={missingStyle}>
        {t`No heart rate was recorded for this session.`}
      </p>
    );
  }

  const rateDomain = has.rate ? domainOf(rows, 'rate') : null;
  const rateUnit = sport === 'erg' ? 'spm' : 'rpm';
  if (rateDomain) {
    const [lo, hi] = rateDomain;
    out.push(
      <Chart
        key="rate"
        rows={rows}
        dataKey="rate"
        color={THEME.positive}
        domain={rateDomain}
        format={(v) => `${Math.round(v)}`}
        unit={rateUnit}
        label={
          sport === 'erg'
            ? t`Stroke rate across ${over}, between ${lo} and ${hi} spm.`
            : t`Cadence across ${over}, between ${lo} and ${hi} rpm.`
        }
        height={height}
        tooltip={tooltip}
      />
    );
  } else {
    out.push(
      <p key="no-rate" style={missingStyle}>
        {sport === 'erg'
          ? t`No stroke rate was recorded for this session.`
          : t`No cadence was recorded for this session.`}
      </p>
    );
  }

  return <div>{out}</div>;
}
