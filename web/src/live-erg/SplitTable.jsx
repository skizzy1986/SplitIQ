import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { shapeSplitTable } from './intervalModel.js';

// Mid-piece split table. Shaping (planned metres vs time, sum, ΔW, the
// current-split arrow) lives in intervalModel.shapeSplitTable; this is the
// v10 table.st presentation on THEME tokens. Band state is carried on the
// row for callers, but the table does not colour a row by band alone.
export function SplitTable({
  workout,
  splits = [],
  current,
  phase,
  units = 'watts',
  summary = false,
  skip = 0,
  termsMode = 'rowing',
  rowHeight,
}) {
  const table = shapeSplitTable({
    workout,
    splits,
    current,
    phase,
    units,
    summary,
    skip,
    terms: termsMode,
  });
  const rh = rowHeight ?? (summary ? 28 : 44);

  return (
    <div
      data-testid="live-erg-split-table"
      style={{ width: '100%', overflow: 'auto' }}
    >
      <table
        aria-label="Split table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: FONT.mono,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th
                key={h.id}
                scope="col"
                style={{
                  fontFamily: FONT.sans,
                  fontSize: TYPE.label.size,
                  letterSpacing: '0.02em',
                  color: THEME.muted,
                  fontWeight: TYPE.label.weight,
                  textAlign: i === 0 ? 'left' : 'right',
                  padding:
                    i === 0
                      ? `0 ${SPACE.xs}px ${SPACE.xs}px ${SPACE.sm}px`
                      : `0 ${SPACE.xs}px ${SPACE.xs}px`,
                  whiteSpace: 'nowrap',
                  background: 'transparent',
                }}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => {
            const isNow = row.kind === 'now';
            const isPlan = row.kind === 'plan';
            const isSum = row.kind === 'sum';
            const keys = table.headers.map((h) => h.id);
            return (
              <tr
                key={`${row.kind}-${row.cells['#']}-${rowIndex}`}
                data-kind={row.kind}
                data-band={row.band ? row.band.dir : undefined}
                style={{ height: rh }}
              >
                {keys.map((col, i) => {
                  const isFirst = i === 0;
                  const isLast = i === keys.length - 1;
                  let value = col === 'REST' ? row.rest || '' : row.cells[col];
                  if (value == null) value = isPlan ? '\u00b7' : '';
                  const style = {
                    textAlign: isFirst ? 'left' : 'right',
                    padding: isFirst
                      ? `0 ${SPACE.xs}px 0 ${SPACE.sm}px`
                      : `0 ${SPACE.xs}px`,
                    fontSize: rh >= 40 ? 16 : 15,
                    fontWeight: isNow || isSum ? 700 : 500,
                    whiteSpace: 'nowrap',
                    color: isPlan
                      ? THEME.textFaint
                      : isNow || isSum
                        ? THEME.textStrong
                        : THEME.text,
                    background: isNow ? THEME.raised : 'transparent',
                    borderBottom: isSum ? `1px solid ${THEME.border}` : 'none',
                    borderTopLeftRadius: isNow && isFirst ? RADIUS.sm : 0,
                    borderBottomLeftRadius: isNow && isFirst ? RADIUS.sm : 0,
                    borderTopRightRadius: isNow && isLast ? RADIUS.sm : 0,
                    borderBottomRightRadius: isNow && isLast ? RADIUS.sm : 0,
                    boxShadow:
                      isNow && isFirst
                        ? `inset 4px 0 0 ${THEME.textStrong}`
                        : undefined,
                  };
                  return (
                    <td key={col} style={style}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default SplitTable;
