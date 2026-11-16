import React from 'react';
import { THEME } from '../../constants/theme.js';
import { LAYER, TYPE } from '../../constants/tokens.js';
import { DESTINATIONS } from '../../constants/destinations.js';
import { useLingui } from '@lingui/react';
import Icon from '../Icon.jsx';
import { alpha } from '../../utils/themeCss.js';

// The artboards draw a 64px bar; 56 was the old value.
export const TAB_BAR_HEIGHT = 64;

export default function BottomTabBar({ activeTab, onTabChange }) {
  const { _ } = useLingui();
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: LAYER.nav,
        height: TAB_BAR_HEIGHT,
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        background: THEME.bg,
        borderTop: `1px solid ${THEME.divider}`,
      }}
    >
      {DESTINATIONS.map(({ id, message, icon }) => {
        const on = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? 'page' : undefined}
            onClick={() => onTabChange(id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: TAB_BAR_HEIGHT,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 0,
              color: on ? THEME.accent : THEME.textSubtle,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 56,
                height: 30,
                borderRadius: 15,
                marginBottom: 2,
                background: on ? alpha(THEME.accent, '1f') : 'transparent',
              }}
            >
              <Icon name={icon} />
            </span>
            <span
              style={{
                fontSize: TYPE.label.size,
                fontWeight: TYPE.label.weight,
                color: on ? THEME.text : THEME.textSubtle,
              }}
            >
              {_(message)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
