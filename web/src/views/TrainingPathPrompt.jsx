import { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
// The words live in the views catalog; load it before this renders, the same
// way the lazy shells do (it is a no-op once they have).
import '../i18n/views.js';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { LAYER, RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import TrainingPathChoice from '../components/TrainingPathChoice.jsx';
import {
  useTrainingSettings,
  useUpdateTrainingSettings,
} from '../hooks/useTrainingSettings.js';
import {
  isGuideDismissed,
  onGuideClosed,
  onGuideOpenRequest,
} from '../utils/firstRunGuide.js';
import { isTestersBuild } from '../utils/testersBuild.js';
import { HR_PATH_RPE, localIsoDate } from '../utils/trainingSettings.js';

// The one screen a new account sees after the first-run guide (#819, H 6 and
// 7). "New" means the account has no settings row at all: an account 027
// backfilled (a live CP), or one that has already chosen or skipped, never sees
// it, and neither does a project where the settings table does not exist yet.
// Nothing is selected on screen. Skipping stores the RPE path.
export default function TrainingPathPrompt({ userId }) {
  const { loaded, available, hasRow } = useTrainingSettings();
  const update = useUpdateTrainingSettings();
  const [guideOpen, setGuideOpen] = useState(
    () => isTestersBuild() && !isGuideDismissed(userId)
  );
  const [failed, setFailed] = useState(false);
  const headingRef = useRef(null);
  const visible =
    Boolean(userId) && loaded && available && !hasRow && !guideOpen;

  useEffect(() => {
    const stopOpen = onGuideOpenRequest(() => setGuideOpen(true));
    const stopClosed = onGuideClosed(() => setGuideOpen(false));
    return () => {
      stopOpen();
      stopClosed();
    };
  }, []);

  useEffect(() => {
    if (visible) headingRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const save = async (path) => {
    setFailed(false);
    try {
      await update.mutateAsync({
        hr_path: path,
        hr_path_chosen_on: localIsoDate(),
      });
    } catch {
      // Reported by react-query's mutation handler; the screen says so.
      setFailed(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="training-path-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: LAYER.modal,
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
          borderRadius: RADIUS.md,
          padding: `${SPACE.xl}px ${SPACE.lg}px`,
          color: THEME.text,
        }}
      >
        <h2
          id="training-path-title"
          ref={headingRef}
          tabIndex={-1}
          style={{
            outline: 'none',
            margin: `0 0 ${SPACE.md}px`,
            fontSize: TYPE.title.size,
            fontWeight: TYPE.title.weight,
          }}
        >
          <Trans comment="Heading of the one-time strap question after the first-run guide">
            Do you have a heart-rate strap?
          </Trans>
        </h2>
        <TrainingPathChoice
          onChoose={save}
          onSkip={() => save(HR_PATH_RPE)}
          disabled={update.isPending}
        />
        <p
          role="status"
          style={{
            margin: `${SPACE.md}px 0 0`,
            fontSize: TYPE.bodySm.size,
            color: failed ? THEME.warning : THEME.muted,
          }}
        >
          {failed ? (
            <Trans comment="Error: a save did not go through">
              Could not save that. Try again.
            </Trans>
          ) : (
            <Trans comment="Reassurance under the strap question">
              You can change this later in Settings.
            </Trans>
          )}
        </p>
      </div>
    </div>
  );
}
