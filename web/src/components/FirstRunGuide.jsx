import { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessions } from '../hooks/useSessions.js';
import { useAnchors } from '../hooks/useAnchors.js';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { guideFor } from '../constants/firstRunGuide.js';
import {
  dismissGuide,
  isGuideDismissed,
  isSampleSession,
  onGuideOpenRequest,
} from '../utils/firstRunGuide.js';
import { clearSampleSessions } from '../utils/setRowingCp.js';
import SetRowingCpForm from './SetRowingCpForm.jsx';

// Testers-only walkthrough (#797). Copy lives in firstRunGuide.js, not the
// catalogs, so dash es does not grow. Lazy-loaded from AuthGate.
export default function FirstRunGuide({ userId }) {
  const { i18n } = useLingui();
  const copy = guideFor(i18n.locale);
  const [open, setOpen] = useState(() => !isGuideDismissed(userId));
  const [step, setStep] = useState(0);
  const queryClient = useQueryClient();
  const { cp, cpAvailable } = useAnchors();
  const sessions = useSessions({ mode: 'recent' });
  const [clearStatus, setClearStatus] = useState(null);
  const [clearing, setClearing] = useState(false);

  useEffect(
    () =>
      onGuideOpenRequest(() => {
        setStep(0);
        setOpen(true);
        setClearStatus(null);
      }),
    []
  );

  if (!open || !userId) return null;

  const steps = copy.steps;
  const current = steps[step];
  const last = step === steps.length - 1;
  const sampleCount = (sessions.data ?? []).filter(isSampleSession).length;

  const close = () => {
    dismissGuide(userId);
    setOpen(false);
  };

  const clear = async () => {
    if (sampleCount === 0) {
      setClearStatus('none');
      return;
    }
    if (!window.confirm(copy.welcomeCard.clearConfirm)) return;
    setClearing(true);
    setClearStatus(null);
    const result = await clearSampleSessions();
    setClearing(false);
    if (!result.ok) {
      setClearStatus('error');
      return;
    }
    setClearStatus('cleared');
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: THEME.raised,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: '22px 20px',
          color: THEME.text,
        }}
      >
        <div style={{ fontSize: 11, color: THEME.muted, marginBottom: 6 }}>
          {copy.title} · {step + 1} / {steps.length}
        </div>
        <h2
          id="first-run-title"
          style={{
            margin: '0 0 10px',
            fontSize: TYPE.title.size,
            fontWeight: TYPE.title.weight,
          }}
        >
          {current.title}
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>
          {current.body}
        </p>

        {current.hasCp && (
          <>
            {!cpAvailable && (
              <div
                style={{ fontSize: 12, color: THEME.muted, marginBottom: 4 }}
              >
                {copy.welcomeCard.notSet}
              </div>
            )}
            <SetRowingCpForm copy={copy.welcomeCard} currentCp={cp} />
          </>
        )}

        {current.hasSquat && (
          <a
            href="/squat"
            style={{
              display: 'inline-block',
              marginTop: SPACE.sm,
              color: THEME.accent,
              fontSize: 13,
            }}
          >
            {copy.welcomeCard.openSquat}
          </a>
        )}

        {current.hasSamples && (
          <div style={{ marginTop: SPACE.md }}>
            <button
              type="button"
              disabled={clearing}
              onClick={clear}
              style={{
                minHeight: 44,
                width: '100%',
                border: `1px solid ${THEME.border}`,
                borderRadius: RADIUS.sm,
                background: THEME.surface,
                color: THEME.text,
                fontFamily: 'inherit',
                fontSize: TYPE.body.size,
                cursor: clearing ? 'default' : 'pointer',
              }}
            >
              {copy.welcomeCard.clearSamples}
            </button>
            {clearStatus === 'cleared' && (
              <div
                role="status"
                style={{ color: THEME.positive, fontSize: 11, marginTop: 6 }}
              >
                {copy.welcomeCard.cleared}
              </div>
            )}
            {clearStatus === 'error' && (
              <div
                role="alert"
                style={{ color: THEME.critical, fontSize: 11, marginTop: 6 }}
              >
                {copy.welcomeCard.clearError}
              </div>
            )}
            {clearStatus === 'none' && (
              <div
                role="status"
                style={{ color: THEME.muted, fontSize: 11, marginTop: 6 }}
              >
                {copy.welcomeCard.noneToClear}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: SPACE.sm,
            marginTop: SPACE.lg,
            flexWrap: 'wrap',
          }}
        >
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              style={textBtn}
            >
              {copy.back}
            </button>
          )}
          <button type="button" onClick={close} style={textBtn}>
            {copy.skip}
          </button>
          <button
            type="button"
            onClick={() => (last ? close() : setStep((s) => s + 1))}
            style={{
              ...textBtn,
              marginLeft: 'auto',
              background: THEME.positive,
              color: THEME.surface,
              border: 'none',
              padding: '10px 16px',
              fontWeight: 700,
            }}
          >
            {last ? copy.done : copy.next}
          </button>
        </div>
      </div>
    </div>
  );
}

const textBtn = {
  minHeight: 44,
  padding: '0 12px',
  background: 'none',
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.sm,
  color: THEME.muted,
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};
