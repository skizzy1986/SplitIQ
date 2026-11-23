import { useRef } from 'react';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE } from '../../constants/tokens.js';
import {
  SHARE_BUTTON,
  SHARE_BUTTON_LABEL,
  SHARE_CLOSE,
  SHARE_FIELD_LABEL,
  SHARE_TITLE,
  SHARE_WAITING,
} from '../constants/share.js';
import { useShareLink } from '../hooks/useShareLink.js';
import { footerButton } from './StageControls.jsx';
import { secondaryButton, srOnly } from './ui.js';

const status = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.4,
  color: THEME.text,
};

/**
 * "Copy link" for the view on screen. Lives in StageControls' share slot: on
 * desktop a third button in the rail footer, with its message and fallback
 * field in a panel set just to the left of that footer, over the stage. The
 * rail has no empty band above the footer (#487), and a panel laid over the
 * Show switches hides them from the pointer and from Shift+Tab (#490). The
 * status line is not interactive, so it does not take hits. On a phone the
 * same parts sit in flow in the bar's Share tab.
 *
 * The status line is one node, mounted from the first paint on both layouts,
 * so what is shown and what is announced cannot drift apart.
 */
export default function ShareLink({ getLink, ready, wide }) {
  const fieldRef = useRef(null);
  const buttonRef = useRef(null);
  const { message, fieldOpen, link, copy, closeField } = useShareLink({
    getLink,
    fieldRef,
    buttonRef,
  });

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeField();
  };

  const button = (
    <button
      ref={buttonRef}
      type="button"
      onClick={copy}
      disabled={!ready}
      aria-label={SHARE_BUTTON_LABEL}
      aria-describedby={ready ? undefined : 'share-waiting'}
      style={{
        ...(wide ? footerButton : { ...secondaryButton, flexShrink: 0 }),
        minWidth: 44,
        ...(ready ? {} : { opacity: 0.5, cursor: 'not-allowed' }),
      }}
    >
      {SHARE_BUTTON}
    </button>
  );
  const statusLine = (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="share-status"
      style={wide ? status : { ...status, flex: 1, minWidth: 0 }}
    >
      {message}
    </p>
  );
  const field = fieldOpen && (
    <div style={{ display: 'flex', gap: SPACE.xs }} onKeyDown={onKeyDown}>
      <input
        ref={fieldRef}
        type="text"
        readOnly
        aria-label={SHARE_FIELD_LABEL}
        value={link ?? ''}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          boxSizing: 'border-box',
          padding: `0 ${SPACE.sm}px`,
          // 16 px: iOS zooms the page into a focused field set any smaller.
          fontSize: 16,
          background: THEME.field,
          color: THEME.text,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.sm,
        }}
      />
      <button
        type="button"
        onClick={closeField}
        style={{
          ...secondaryButton,
          minWidth: 44,
          padding: `${SPACE.sm}px ${SPACE.md}px`,
        }}
      >
        {SHARE_CLOSE}
      </button>
    </div>
  );
  const head = (
    <>
      <h3 id="share-title" style={srOnly}>
        {SHARE_TITLE}
      </h3>
      {!ready && (
        <span id="share-waiting" style={srOnly}>
          {SHARE_WAITING}
        </span>
      )}
    </>
  );

  if (wide) {
    // Shown only while there is something to say or the field is open;
    // otherwise visually hidden, never unmounted, so the live region stays.
    const shown = !!message || fieldOpen;
    return (
      <>
        {head}
        {button}
        <div
          data-testid="share-panel"
          style={
            shown
              ? {
                  position: 'absolute',
                  // Beside the footer, not above it: above it the panel covers
                  // the Show switches. The gutter matches the hero grid's gap.
                  right: `calc(100% + ${SPACE.md}px)`,
                  bottom: 0,
                  width: '100%',
                  zIndex: 2,
                  // "Link copied." must not block a drag on the model under it.
                  // The field is a control, so it keeps its hits.
                  pointerEvents: fieldOpen ? 'auto' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: SPACE.sm,
                  padding: SPACE.sm,
                  boxSizing: 'border-box',
                  background: THEME.surface,
                  border: `1px solid ${THEME.border}`,
                  borderRadius: RADIUS.sm,
                }
              : srOnly
          }
        >
          {statusLine}
          {field}
        </div>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
      {head}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
        {button}
        {statusLine}
      </div>
      {field}
    </div>
  );
}
