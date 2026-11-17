import { useId, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { MIN_ANALYSIS_S, MIN_COVERAGE } from '../../utils/sessionAnalysis.js';
import { wattsText, withUnit } from './units.js';

const nameStyle = {
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  color: THEME.text,
};
const valueStyle = {
  margin: 0,
  fontFamily: FONT.mono,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  color: THEME.text,
};
const howStyle = {
  margin: `${SPACE.xxs}px 0 ${SPACE.md}px`,
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.bodySm.weight,
  lineHeight: TYPE.bodySm.lineHeight,
  color: THEME.textSubtle,
};

// The expert depth: peak powers, weighted power, variability and drift, behind
// a disclosure that starts closed. Each figure says how it is derived, and a
// figure the session cannot support says what it would need. The words
// describe; they never judge or instruct.
//   peaks: peakPowers(series) · variability: variabilityIndex(series) or
//   null · drift: aerobicDrift(series) or null · needs: analysisNeeds(series)
export default function MoreDetail({
  peaks = [],
  variability = null,
  drift = null,
  needs = {},
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const minutes = Math.round(MIN_ANALYSIS_S / 60);
  const percent = Math.round(MIN_COVERAGE * 100);

  const needText = (need) => {
    if (need === 'duration') {
      return t`Needs at least ${minutes} min of moving time.`;
    }
    if (need === 'power') {
      return t`Needs a power reading for at least ${percent}% of the moving time.`;
    }
    return t`Needs a heart rate reading for at least ${percent}% of each half of the moving time.`;
  };

  const rows = [];
  const add = (key, name, value, how) => rows.push({ key, name, value, how });

  for (const p of peaks) {
    const window = Math.round(p.windowS / 60);
    let value;
    if (p.watts != null) value = wattsText(p.watts);
    else if (p.needs === 'power') value = t`Needs a power reading.`;
    else value = t`Needs a session at least ${window} min long.`;
    add(`peak-${p.windowS}`, t`Peak power, ${window} min`, value, null);
  }
  if (peaks.length) {
    rows[rows.length - 1].how =
      t`The highest average power over any stretch of that length in the elapsed time, a pause counting as 0 W.`;
  }

  add(
    'weighted',
    t`Weighted power`,
    variability ? wattsText(variability.np) : needText(needs.variability),
    t`Power over the moving time, averaged over each 30 s, each value raised to the fourth power, those averaged, then the fourth root taken. Hard stretches count for more than their share of the time.`
  );
  const avg = variability ? Math.round(variability.avg) : null;
  add(
    'variability',
    t`Variability`,
    variability ? variability.vi.toFixed(2) : needText(needs.variability),
    variability
      ? t`Weighted power divided by the average power, ${avg} W. 1.00 is an even output throughout.`
      : t`Weighted power divided by the average power. 1.00 is an even output throughout.`
  );
  const r1 = drift ? drift.firstRatio.toFixed(2) : null;
  const r2 = drift ? drift.secondRatio.toFixed(2) : null;
  add(
    'drift',
    t`Drift`,
    drift ? withUnit(drift.driftPct.toFixed(1), '%') : needText(needs.drift),
    drift
      ? t`Average power over average heart rate: ${r1} W/bpm in the first half of the moving time, ${r2} W/bpm in the second. Drift is the change between them as a share of the first; above zero, the second half had less power per beat.`
      : t`Average power over average heart rate in each half of the moving time, and the change between them as a share of the first.`
  );

  return (
    <section style={{ fontFamily: FONT.sans }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={{
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
        }}
      >
        {t`More detail`}
      </button>
      <div id={panelId} hidden={!open} style={{ marginTop: SPACE.md }}>
        <dl style={{ margin: 0 }}>
          {rows.map(({ key, name, value, how }) => (
            <div
              key={key}
              data-detail={key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                columnGap: SPACE.sm,
                marginBottom: how ? 0 : SPACE.xs,
              }}
            >
              <dt style={nameStyle}>{name}</dt>
              <dd style={{ ...valueStyle, textAlign: 'right' }}>{value}</dd>
              {how && (
                <dd style={{ ...howStyle, gridColumn: '1 / -1' }}>{how}</dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
