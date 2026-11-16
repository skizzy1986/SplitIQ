import { THEME } from '../constants/theme.js';
import { SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

export default function ListRow({ title, meta, onClick }) {
  const inner = (
    <>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: TYPE.body.size,
            fontWeight: 600,
            color: THEME.text,
          }}
        >
          {title}
        </span>
        {meta && (
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: TYPE.bodySm.size,
              color: THEME.textFaint,
            }}
          >
            {meta}
          </span>
        )}
      </span>
    </>
  );
  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.md,
    width: '100%',
    minHeight: onClick ? 44 : 64,
    padding: `${SPACE.md}px 0`,
    border: 'none',
    borderTop: `1px solid ${THEME.divider}`,
    background: 'transparent',
    textAlign: 'left',
    fontFamily: FONT.sans,
    color: THEME.text,
    cursor: onClick ? 'pointer' : 'default',
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={style}>
        {inner}
      </button>
    );
  }
  return <div style={style}>{inner}</div>;
}
