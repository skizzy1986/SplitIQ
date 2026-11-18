import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { formatClock } from '../../utils/sessionPage.js';
import SegmentedControl from '../SegmentedControl.jsx';
import {
  bpmText,
  distanceText,
  paceText,
  rateText,
  speedText,
  wattsText,
} from './units.js';

const positive = (v) => typeof v === 'number' && v > 0;
const EMPTY = '–';

const cellStyle = {
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontFamily: FONT.mono,
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.bodySm.weight,
  borderBottom: `1px solid ${THEME.divider}`,
};
const headStyle = {
  ...cellStyle,
  fontFamily: FONT.sans,
  fontSize: TYPE.label.size,
  fontWeight: TYPE.label.weight,
  color: THEME.textFaint,
};

// The session in splits: by distance, or by recorded lap. Each row's first
// cell is a toggle button, so a split can be selected by keyboard or by tap
// (the trace's drag needs a mouse); pressing the selected one again clears.
// A column no split has a value for is left out; a missing value in a row is
// a dash, never a zero.
//   splits: distanceSplits(...) or lapSplits(...) · mode: 'distance' | 'laps'
//   splitM, splitOptions, onSplitM: the split distance, offered for rowing
//   selectedIndex: the selected split's index or null · onSelect(index|null)
export default function SplitsTable({
  splits,
  sport,
  mode,
  splitM = null,
  splitOptions = null,
  onSplitM = null,
  selectedIndex = null,
  onSelect,
}) {
  const { t } = useLingui();
  const hasAny = (key) => splits.some((s) => positive(s[key]));
  const columns = [
    {
      key: 'time',
      label: t`Time`,
      show: true,
      text: (s) => (positive(s.movingS) ? formatClock(s.movingS) : null),
    },
    {
      key: 'distance',
      label: t`Distance`,
      show: hasAny('distanceM'),
      text: (s) => (positive(s.distanceM) ? distanceText(s.distanceM) : null),
    },
    {
      key: 'watts',
      label: t`Power`,
      show: hasAny('avgWatts'),
      text: (s) => (positive(s.avgWatts) ? wattsText(s.avgWatts) : null),
    },
    sport === 'erg'
      ? {
          key: 'pace',
          label: t`Pace`,
          show: hasAny('pace500'),
          text: (s) => (positive(s.pace500) ? paceText(s.pace500) : null),
        }
      : {
          key: 'speed',
          label: t`Speed`,
          show: hasAny('speedKmh'),
          text: (s) => (positive(s.speedKmh) ? speedText(s.speedKmh) : null),
        },
    {
      key: 'hr',
      label: t`Heart rate`,
      show: hasAny('avgHr'),
      text: (s) => (positive(s.avgHr) ? bpmText(s.avgHr) : null),
    },
    {
      key: 'rate',
      label: sport === 'erg' ? t`Stroke rate` : t`Cadence`,
      show: hasAny('avgRate'),
      text: (s) => (positive(s.avgRate) ? rateText(s.avgRate, sport) : null),
    },
  ].filter((c) => c.show);

  const options =
    sport === 'erg' && mode === 'distance' && splitOptions?.length && onSplitM
      ? splitOptions.map((m) => ({ id: m, label: distanceText(m) }))
      : null;
  const every = splitM ? distanceText(splitM) : '';
  const caption =
    mode === 'laps' ? t`One row per recorded lap.` : t`One row every ${every}.`;

  return (
    <div style={{ fontFamily: FONT.sans }}>
      {options && (
        <div style={{ maxWidth: 320, marginBottom: SPACE.sm }}>
          <SegmentedControl
            label={t`Split distance`}
            items={options}
            value={splitM}
            onChange={onSplitM}
          />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            color: THEME.text,
          }}
        >
          <caption
            style={{
              captionSide: 'top',
              textAlign: 'left',
              paddingBottom: SPACE.xs,
              fontSize: TYPE.bodySm.size,
              fontWeight: TYPE.bodySm.weight,
              color: THEME.textSubtle,
            }}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...headStyle, textAlign: 'left' }}>
                {mode === 'laps' ? t`Lap` : t`Split`}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" style={headStyle}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const on = s.index === selectedIndex;
              const n = s.index + 1;
              return (
                <tr
                  key={s.index}
                  data-split={s.index}
                  style={{ background: on ? THEME.raised : 'transparent' }}
                >
                  <th
                    scope="row"
                    style={{ ...cellStyle, textAlign: 'left', padding: 0 }}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onSelect(on ? null : s.index)}
                      style={{
                        minHeight: 44,
                        minWidth: 44,
                        padding: `0 ${SPACE.sm}px`,
                        border: `1px solid ${on ? THEME.accent : THEME.border}`,
                        borderRadius: RADIUS.sm,
                        background: on ? THEME.surface : 'transparent',
                        color: THEME.text,
                        fontFamily: FONT.sans,
                        fontSize: TYPE.bodySm.size,
                        fontWeight: TYPE.label.weight,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      {s.partial
                        ? t({
                            message: `${n} (partial)`,
                            comment:
                              'Splits table: the last split, shorter than the others',
                          })
                        : String(n)}
                    </button>
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} style={cellStyle}>
                      {c.text(s) ?? EMPTY}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
