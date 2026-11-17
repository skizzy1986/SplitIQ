import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { provenanceCopy } from './sourceCopy.js';

const MEASURED = {
  power: msg({ message: 'power', comment: 'Session caption list item' }),
  hr: msg({ message: 'heart rate', comment: 'Session caption list item' }),
  strokeRate: msg({
    message: 'stroke rate',
    comment: 'Session caption list item',
  }),
  cadence: msg({ message: 'cadence', comment: 'Session caption list item' }),
  distance: msg({ message: 'distance', comment: 'Session caption list item' }),
};

const DERIVED = {
  pacePower: msg({
    message: 'pace from power',
    comment: 'Session caption list item',
  }),
  paceDistance: msg({
    message: 'pace from distance and time',
    comment: 'Session caption list item',
  }),
  speedDistance: msg({
    message: 'speed from distance and time',
    comment: 'Session caption list item',
  }),
  zonesCp: msg({
    message: 'zones from your rowing CP anchor',
    comment: 'Session caption list item',
  }),
  zonesFtp: msg({
    message: 'zones from your bike FTP anchor',
    comment: 'Session caption list item',
  }),
  loadSrpe: msg({
    message: 'load from your sRPE and duration',
    comment: 'Session caption list item',
  }),
  loadPower: msg({
    message: 'load from average power against your anchor',
    comment: 'Session caption list item',
  }),
};

const captionStyle = {
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.bodySm.weight,
  lineHeight: TYPE.bodySm.lineHeight,
  color: THEME.textSubtle,
  margin: `${SPACE.xs}px 0 0`,
};

// Where the session's data came from, and which numbers were measured by a
// device against which were derived here. Source-neutral: the words that name
// a source come from sourceCopy.js.
export default function ProvenanceNote({
  source = null,
  href = null,
  origin = null,
  measured = [],
  derived = [],
}) {
  const { t, i18n } = useLingui();
  const copy = provenanceCopy(source, { href, origin });
  const list = (keys, table) =>
    keys
      .filter((k) => table[k])
      .map((k) => i18n._(table[k]))
      .join(', ');
  const measuredText = list(measured, MEASURED);
  const derivedText = list(derived, DERIVED);
  return (
    <section
      aria-label={t`Where this data comes from`}
      style={{
        marginTop: SPACE.xl,
        paddingTop: SPACE.md,
        borderTop: `1px solid ${THEME.divider}`,
        fontFamily: FONT.sans,
      }}
    >
      <p style={{ ...captionStyle, color: THEME.text, marginTop: 0 }}>
        {copy
          ? i18n._(copy.line)
          : t({
              message: 'Summary from your log.',
              comment: 'Session page provenance when no device trace exists',
            })}
        {copy?.link && (
          <>
            {' '}
            <a
              href={copy.link.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: THEME.accent,
                fontWeight: 700,
                textDecoration: 'underline',
              }}
            >
              {copy.link.text}
            </a>
          </>
        )}
      </p>
      {measuredText && (
        <p style={captionStyle}>
          {t({
            message: `Measured by the device: ${measuredText}.`,
            comment: 'Session caption; the list is translated item by item',
          })}
        </p>
      )}
      {derivedText && (
        <p style={captionStyle}>
          {t({
            message: `Derived here: ${derivedText}.`,
            comment: 'Session caption; the list is translated item by item',
          })}
        </p>
      )}
    </section>
  );
}
