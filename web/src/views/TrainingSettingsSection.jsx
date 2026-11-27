import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import BirthYearForm from '../components/BirthYearForm.jsx';
import TrainingPathChoice from '../components/TrainingPathChoice.jsx';
import {
  useTrainingSettings,
  useUpdateTrainingSettings,
} from '../hooks/useTrainingSettings.js';
import {
  HR_PATH_RPE,
  HR_PATH_STRAP,
  localIsoDate,
} from '../utils/trainingSettings.js';

const cardStyle = {
  background: THEME.surface,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.lg}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.md,
};

const subheadStyle = {
  margin: 0,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  color: THEME.text,
};

// Settings > Training (#819, H 9 and 13). Renders nothing until the account's
// settings table is there to read, so a project without migration 027 shows no
// broken controls. Changing the strap path is one tap: no confirm step.
export default function TrainingSettingsSection() {
  const { loaded, available, hrPath, birthYear } = useTrainingSettings();
  const update = useUpdateTrainingSettings();
  const [pathError, setPathError] = useState(false);

  if (!loaded || !available) return null;

  const choose = async (path) => {
    setPathError(false);
    try {
      await update.mutateAsync({
        hr_path: path,
        hr_path_chosen_on: localIsoDate(),
      });
    } catch {
      // Reported by react-query's mutation handler; the screen says so.
      setPathError(true);
    }
  };

  return (
    <section
      aria-labelledby="settings-training"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}
    >
      <h2
        id="settings-training"
        style={{
          margin: 0,
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          letterSpacing: TYPE.title.letterSpacing,
          color: THEME.textStrong,
        }}
      >
        <Trans comment="Settings section heading above the training options">
          Training
        </Trans>
      </h2>
      <div style={cardStyle}>
        <h3 style={subheadStyle}>
          <Trans comment="Settings sub-heading: how the user tracks effort, with or without a heart-rate strap">
            Heart-rate strap
          </Trans>
        </h3>
        <TrainingPathChoice
          value={hrPath}
          onChoose={choose}
          disabled={update.isPending}
        />
        <div
          aria-live="polite"
          style={{ fontSize: TYPE.bodySm.size, color: THEME.muted }}
        >
          {pathError && (
            <Trans comment="Error: a save did not go through">
              Could not save that. Try again.
            </Trans>
          )}
          {!pathError && hrPath === HR_PATH_STRAP && (
            <Trans comment="Settings: current path is the strap path">
              You are on the strap path.
            </Trans>
          )}
          {!pathError && hrPath === HR_PATH_RPE && (
            <Trans comment="Settings: current path is the no-strap path, rating effort by feel">
              You are on the no-strap path. You rate effort by feel.
            </Trans>
          )}
          {!pathError && hrPath == null && (
            <Trans comment="Settings: nothing chosen yet">
              You have not chosen yet.
            </Trans>
          )}
        </div>
      </div>
      <div style={cardStyle}>
        <BirthYearForm
          key={birthYear ?? 'none'}
          birthYear={birthYear}
          onSave={(year) => update.mutateAsync({ birth_year: year })}
          onRemove={() => update.mutateAsync({ birth_year: null })}
        />
      </div>
    </section>
  );
}
