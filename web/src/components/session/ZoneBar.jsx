import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { zoneLabel } from './zoneLabels.js';

const STATUS = {
  confirmed: msg({ message: 'confirmed', comment: 'Anchor status' }),
  provisional: msg({ message: 'provisional', comment: 'Anchor status' }),
  unvalidated: msg({ message: 'unvalidated', comment: 'Anchor status' }),
};

const lineStyle = {
  margin: `${SPACE.xs}px 0`,
  fontFamily: FONT.sans,
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.bodySm.weight,
  lineHeight: TYPE.bodySm.lineHeight,
  color: THEME.textSubtle,
};

const minutes = (s) => Math.round(s / 60);

// Time in zone: a stacked bar and the minutes per zone, with the anchor the
// zones come from. With no anchor it says zones need one and draws nothing.
//   anchor: { kind: 'cp' | 'ftp', value, status } or null
export default function ZoneBar({ result, anchor, hasPower }) {
  const { t, i18n } = useLingui();
  if (!hasPower) {
    return (
      <p style={lineStyle}>
        {t({
          message: 'This session has no power reading, so no time in zone.',
          comment: 'Session page zones',
        })}
      </p>
    );
  }
  if (!anchor || !(anchor.value > 0) || !result) {
    return (
      <p style={lineStyle}>
        {anchor?.kind === 'ftp'
          ? t({
              message:
                'Zones need a bike FTP anchor, and none is set, so no zones are drawn.',
              comment: 'Session page zones',
            })
          : t({
              message:
                'No zones are drawn yet. They appear once a rowing test has set your power zones.',
              comment: 'Session page zones',
            })}
      </p>
    );
  }
  const value = Math.round(anchor.value);
  const status = STATUS[anchor.status] ? i18n._(STATUS[anchor.status]) : null;
  const source =
    anchor.kind === 'ftp'
      ? status
        ? t`Zones from your bike FTP, ${value} W (${status}).`
        : t`Zones from your bike FTP, ${value} W.`
      : status
        ? t`Zones from your rowing CP, ${value} W (${status}).`
        : t`Zones from your rowing CP, ${value} W.`;
  const unpowered = minutes(result.unpoweredS);
  const shown = result.bands.filter((b) => b.seconds > 0);
  const summary = shown
    .map((b) => `${zoneLabel(i18n, b)} ${minutes(b.seconds)} min`)
    .join(', ');
  return (
    <div>
      <div
        role="img"
        aria-label={t`Time in zone: ${summary}.`}
        style={{
          display: 'flex',
          height: 16,
          borderRadius: RADIUS.sm,
          overflow: 'hidden',
          background: THEME.field,
        }}
      >
        {shown.map((b) => (
          <div
            key={b.key}
            style={{ width: `${b.fraction * 100}%`, background: b.color }}
          />
        ))}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: `${SPACE.sm}px 0`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${SPACE.xs}px ${SPACE.md}px`,
        }}
      >
        {result.bands.map((b) => (
          <li
            key={b.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SPACE.xs,
              fontFamily: FONT.mono,
              fontSize: TYPE.bodySm.size,
              fontWeight: 700,
              color: b.seconds > 0 ? THEME.text : THEME.textFaint,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: RADIUS.pill,
                background: b.color,
              }}
            />
            <span style={{ fontFamily: FONT.sans }}>{zoneLabel(i18n, b)}</span>{' '}
            {minutes(b.seconds)} min · {Math.round(b.fraction * 100)}%
          </li>
        ))}
      </ul>
      <p style={lineStyle}>{source}</p>
      {result.unpoweredS >= 60 && (
        <p style={lineStyle}>
          {t`${unpowered} min of moving time had no power reading and is not in any zone.`}
        </p>
      )}
    </div>
  );
}
