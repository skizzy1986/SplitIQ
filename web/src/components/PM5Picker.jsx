import React, { useEffect, useId, useRef } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE } from '../constants/tokens.js';
import { PM5_ERROR_MESSAGES } from '../constants/pm5ErrorMessages.js';

// The Android list of PM5s in range (#696). Full screen on the classic
// connect page; `embedded` sits it inside the v10 planner's connect card.
export default function PM5Picker({
  monitors,
  phase,
  connectingId,
  errorCode,
  locationOff,
  onChoose,
  onRetry,
  onCancel,
  embedded = false,
}) {
  const { t, i18n } = useLingui();
  const headingId = useId();
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const unnamed = t({
    message: 'Unnamed PM5',
    comment:
      'A rowing monitor in the list that broadcast no name; PM5 is the monitor: keep it',
  });
  const errorText =
    errorCode && Object.hasOwn(PM5_ERROR_MESSAGES, errorCode)
      ? i18n._(PM5_ERROR_MESSAGES[errorCode])
      : null;
  const connecting = monitors.find((m) => m.id === connectingId);
  // The empty state replaces the list, stale rows included.
  const empty = phase === 'empty';

  let statusText;
  if (connecting) {
    const name = connecting.name || unnamed;
    statusText = (
      <Trans comment="Status line while the app connects to the monitor the user tapped; {name} is its broadcast name, e.g. PM5 431719123 Row">
        Connecting to {name}…
      </Trans>
    );
  } else if (empty) {
    statusText = (
      <Trans comment="The search found no PM5 rowing monitor in range">
        No PM5 found nearby. Wake your monitor and try again.
      </Trans>
    );
  } else {
    statusText = (
      <Trans comment="Shown while the app searches for nearby PM5 rowing monitors">
        Searching for PM5s…
      </Trans>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      style={{
        minHeight: embedded ? undefined : 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.lg,
        padding: embedded ? 0 : SPACE.xl,
        boxSizing: 'border-box',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 700,
          color: THEME.text,
          outline: 'none',
        }}
      >
        <Trans comment="Title of the list of nearby rowing monitors; PM5 is the monitor: keep it">
          Choose your PM5
        </Trans>
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.6,
          color: THEME.muted,
        }}
      >
        <Trans comment="Under the title of the list of nearby rowing monitors. Connect is the name of a menu screen on the PM5 monitor itself, not a button in the app">
          The number in each name is the serial on your monitor's Connect
          screen.
        </Trans>
      </p>

      {errorText && (
        <div
          role="alert"
          style={{
            background:
              'color-mix(in srgb, var(--color-critical) 12%, var(--color-bg))',
            border: `1px solid ${THEME.critical}`,
            borderRadius: RADIUS.sm,
            padding: `${SPACE.md}px ${SPACE.lg}px`,
            fontSize: 12,
            lineHeight: 1.5,
            color: THEME.critical,
          }}
        >
          {errorText}
        </div>
      )}

      <div
        aria-live="polite"
        style={{ fontSize: 12, color: THEME.muted, minHeight: 18 }}
      >
        {statusText}
      </div>

      {!empty && monitors.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: SPACE.sm,
          }}
        >
          {monitors.map((m) => {
            const busy = m.id === connectingId;
            // A stale row keeps its place, so nothing moves under a finger.
            const disabled = m.stale || (connectingId != null && !busy);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onChoose(m.id)}
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  aria-busy={busy || undefined}
                  style={{
                    width: '100%',
                    minHeight: 48,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: SPACE.md,
                    padding: `${SPACE.md}px ${SPACE.lg}px`,
                    background: THEME.surface,
                    border: `1px solid ${busy ? THEME.positive : THEME.border}`,
                    borderRadius: RADIUS.md,
                    color: disabled ? THEME.textDim : THEME.text,
                    fontFamily: FONT.mono,
                    fontSize: 14,
                    textAlign: 'left',
                    cursor: disabled ? 'default' : 'pointer',
                  }}
                >
                  <span>{m.name || unnamed}</span>
                  {busy && (
                    <span
                      style={{
                        fontFamily: FONT.sans,
                        fontSize: 11,
                        color: THEME.positive,
                      }}
                    >
                      <Trans comment="On the list row of the monitor being connected">
                        Connecting…
                      </Trans>
                    </span>
                  )}
                  {m.stale && !busy && (
                    <span
                      style={{
                        fontFamily: FONT.sans,
                        fontSize: 11,
                        color: THEME.textDim,
                      }}
                    >
                      <Trans comment="On a list row whose monitor has not been seen for a few seconds; the row cannot be tapped until it is seen again">
                        Out of range
                      </Trans>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {empty && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: SPACE.md,
            alignItems: 'flex-start',
          }}
        >
          {locationOff && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.6,
                color: THEME.caution,
              }}
            >
              <Trans comment="Hint when no monitor was found and the phone's Location setting is off">
                On Android 11 and older, Location must be on to find a PM5.
              </Trans>
            </p>
          )}
          <button
            type="button"
            onClick={onRetry}
            style={{
              minHeight: 48,
              padding: `${SPACE.md}px ${SPACE.xl}px`,
              fontSize: 14,
              fontWeight: 700,
              background: THEME.positive,
              color: THEME.surface,
              border: 'none',
              borderRadius: RADIUS.md,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Trans comment="Button that searches for PM5 monitors again">
              Try again
            </Trans>
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        style={{
          marginTop: 'auto',
          minHeight: 48,
          padding: `${SPACE.md}px ${SPACE.xl}px`,
          fontSize: 14,
          background: 'transparent',
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.md,
          color: THEME.muted,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Trans comment="Button that closes the list of monitors without connecting">
          Cancel
        </Trans>
      </button>
    </section>
  );
}
