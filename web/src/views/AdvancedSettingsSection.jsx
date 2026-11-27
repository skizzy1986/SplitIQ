import { useQueryClient } from '@tanstack/react-query';
import { useLingui } from '@lingui/react';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { cpFormFor } from '../constants/cpFormCopy.js';
import AdvancedCpForm from '../components/AdvancedCpForm.jsx';
import AnchorProvenance from '../components/AnchorProvenance.jsx';
import { useAnchors } from '../hooks/useAnchors.js';
import {
  anchorHistoryKey,
  useAnchorHistory,
} from '../hooks/useAnchorHistory.js';
import { useTrainingSettings } from '../hooks/useTrainingSettings.js';
import { setRowingCp } from '../utils/setRowingCp.js';

const cardStyle = {
  background: THEME.surface,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.lg}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.lg,
};

// The expert-depth part. Its hooks run only when it is mounted, so a
// simple-depth account never reads its anchor history.
function AdvancedCp({ copy, lang }) {
  const queryClient = useQueryClient();
  const anchors = useAnchors();
  const history = useAnchorHistory('rowing_cp');

  const onSave = async (raw) => {
    const result = await setRowingCp(raw, {
      expectedLiveId: anchors.rowingCpId,
    });
    // A stale answer means another device saved first: refetch so the next
    // save names the new live row. A failure changes nothing, so nothing
    // is refetched.
    if (result.ok || result.cause === 'stale') {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['anchors'] }),
        queryClient.invalidateQueries({
          queryKey: anchorHistoryKey('rowing_cp'),
        }),
      ]);
    }
    return result;
  };

  return (
    <div style={cardStyle}>
      {/* Mounted only after the anchors read has answered, so the field seeds
          from the saved CP (H 38). */}
      {anchors.isSuccess && (
        <AdvancedCpForm copy={copy} currentCp={anchors.cp} onSave={onSave} />
      )}
      <AnchorProvenance
        copy={copy}
        depth="expert"
        live={history.available ? history.live : null}
        retired={history.available ? history.retired : []}
        lang={lang}
      />
    </div>
  );
}

// Settings > Advanced (#819 S4, Gate 2 decision 2): the rowing CP form and
// where the CP came from, at expert depth only. Renders nothing at simple
// depth, and nothing when the settings table is not there to read (a project
// without 027 reads as simple), so production shows no CP entry.
export default function AdvancedSettingsSection() {
  const { i18n } = useLingui();
  const { loaded, available, depth } = useTrainingSettings();
  if (!loaded || !available || depth !== 'expert') return null;

  const copy = cpFormFor(i18n.locale);
  return (
    <section
      aria-labelledby="settings-advanced"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}
    >
      <h2
        id="settings-advanced"
        style={{
          margin: 0,
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          letterSpacing: TYPE.title.letterSpacing,
          color: THEME.textStrong,
        }}
      >
        {copy.advancedTitle}
      </h2>
      <AdvancedCp copy={copy} lang={i18n.locale} />
    </section>
  );
}
