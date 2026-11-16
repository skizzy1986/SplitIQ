import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

// A labelled <nav> of buttons, not an ARIA tabs widget: the panes it switches
// are routes on desktop, and tab roles promise arrow-key behaviour this does
// not have.
export default function SegmentedControl({ label, items, value, onChange }) {
  return (
    <nav
      aria-label={label}
      style={{
        display: 'flex',
        gap: SPACE.xs,
        padding: SPACE.xs,
        borderRadius: RADIUS.pill,
        background: THEME.surface,
        border: `1px solid ${THEME.divider}`,
        fontFamily: FONT.sans,
      }}
    >
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={on ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            style={{
              flex: 1,
              minHeight: 40,
              border: 'none',
              borderRadius: RADIUS.pill,
              background: on ? THEME.raised : 'transparent',
              color: on ? THEME.text : THEME.textSubtle,
              fontFamily: FONT.sans,
              fontSize: TYPE.bodySm.size,
              fontWeight: TYPE.label.weight,
              cursor: 'pointer',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
