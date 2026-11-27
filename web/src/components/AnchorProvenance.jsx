import { THEME } from '../constants/theme.js';
import { SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';
import { dateLocale } from '../utils/displayLocale.js';

// Where the live rowing CP came from (#819 S4, H 5): its origin, the date it
// is valid from, and the test protocol when it came from a test, plus a few
// earlier values. Expert depth only: at simple depth this renders nothing, so
// a new user never sees a CP here. Props in, no Supabase calls.
const EARLIER_SHOWN = 3;

// valid_from is a calendar date ('YYYY-MM-DD'). Built from its parts, so the
// shown day never shifts with the browser's time zone.
function formatDay(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(dateLocale(lang, 'en-AU'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(day);
}

const originOf = (copy, source) => copy.origins[source] ?? copy.origins.unknown;

function protocolOf(copy, row) {
  const protocol = row?.provenance?.protocol;
  if (row?.source !== 'test' || typeof protocol !== 'string') {
    return copy.protocolNone;
  }
  return copy.protocols[protocol] ?? copy.origins.test;
}

const termStyle = {
  fontSize: TYPE.micro.size,
  letterSpacing: TYPE.micro.letterSpacing,
  fontWeight: TYPE.micro.weight,
  color: THEME.muted,
  textTransform: 'uppercase',
};
const valueStyle = {
  margin: 0,
  fontSize: TYPE.body.size,
  color: THEME.text,
};

export default function AnchorProvenance({
  copy,
  depth,
  live,
  retired = [],
  lang,
}) {
  if (depth !== 'expert') return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <h4
        style={{
          margin: 0,
          fontSize: TYPE.bodySm.size,
          fontWeight: TYPE.label.weight,
          color: THEME.text,
        }}
      >
        {copy.provenanceTitle}
      </h4>
      {live == null ? (
        <p style={{ ...valueStyle, color: THEME.muted }}>{copy.noCp}</p>
      ) : (
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: SPACE.md,
            rowGap: SPACE.xs,
            alignItems: 'baseline',
          }}
        >
          <dt style={termStyle}>{copy.originLabel}</dt>
          <dd style={valueStyle}>{originOf(copy, live.source)}</dd>
          <dt style={termStyle}>{copy.dateLabel}</dt>
          <dd style={valueStyle}>{formatDay(live.valid_from, lang) ?? '—'}</dd>
          <dt style={termStyle}>{copy.protocolLabel}</dt>
          <dd style={valueStyle}>{protocolOf(copy, live)}</dd>
        </dl>
      )}
      {retired.length > 0 && (
        <div>
          <div style={termStyle}>{copy.earlierTitle}</div>
          <ul style={{ margin: `${SPACE.xs}px 0 0`, paddingLeft: SPACE.lg }}>
            {retired.slice(0, EARLIER_SHOWN).map((row) => (
              <li
                key={row.id}
                style={{ fontSize: TYPE.bodySm.size, color: THEME.muted }}
              >
                <span style={{ fontFamily: FONT.mono, color: THEME.text }}>
                  {row.value} {row.unit ?? ''}
                </span>{' '}
                · {formatDay(row.valid_from, lang) ?? '—'} ·{' '}
                {originOf(copy, row.source)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
