import React, { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { durationLabel } from '../utils/durationLabel.js';

export default function WorkoutTarget({ session }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);

  if (!session) {
    return (
      <div
        style={{
          padding: '8px 12px',
          fontSize: 10,
          color: THEME.muted,
          letterSpacing: 1,
        }}
      >
        <Trans comment="All capitals">NO PLANNED SESSION TODAY</Trans>
      </div>
    );
  }

  const duration = durationLabel(session.duration, i18n);

  return (
    <div
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: THEME.text,
          fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, color: THEME.caution }}>
            <Trans comment="Label before today's planned session name, all capitals">
              TARGET
            </Trans>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{session.label}</span>
        </div>
        <span style={{ fontSize: 10, color: THEME.muted }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: '0 14px 12px',
            borderTop: `1px solid ${THEME.border}`,
          }}
        >
          {duration && (
            <div style={{ fontSize: 11, color: THEME.muted, marginTop: 8 }}>
              <span style={{ color: THEME.text, fontWeight: 600 }}>
                {duration}
              </span>
              {' · '}
              <Trans comment="Followed by a number or the word easy; sRPE stays as is">
                sRPE target:
              </Trans>{' '}
              <span style={{ color: THEME.text }}>
                {session.srpe ||
                  t({
                    message: 'easy',
                    comment: 'sRPE target when the plan gives no number',
                  })}
              </span>
            </div>
          )}
          {session.notes && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: THEME.muted,
                lineHeight: 1.6,
                borderLeft: `2px solid ${THEME.caution}`,
                paddingLeft: 10,
              }}
            >
              {session.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
