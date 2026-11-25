import React, { useMemo, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import MobileAnalytics from './MobileAnalytics.jsx';
import MobileSessionLog from './MobileSessionLog.jsx';
import MobileStrength from './MobileStrength.jsx';
import ErgView from '../ErgView.jsx';
import { useTSSHistory } from '../../hooks/useTSSHistory.js';
import { calcTrainingLoad } from '../../utils/trainingLoad.js';
import StravaConnectPanel from '../../components/StravaConnectPanel.jsx';
import SegmentedControl from '../../components/SegmentedControl.jsx';
import ScreenHeader from '../../components/ScreenHeader.jsx';
import { THEME } from '../../constants/theme.js';
import { SPACE } from '../../constants/tokens.js';
import { isTestersBuild } from '../../utils/testersBuild.js';

// Progress is the reviewing: is the training working. It absorbs what were the
// separate "Log" and "Strength" tabs — DESIGN_BRIEF.md §2.2.
//
// progress.html draws four sub-tabs (Load · Erg · Strength · History) on one
// SegmentedNav. Three of them have content today. Erg is the power-at-HR
// barometer and is later work, so the strip is built from the panes that exist
// rather than showing a dead tab.
//
// Load is MobileAnalytics, which was the whole Analytics tab before this
// change: the TSB hero, CTL/ATL, the load trend and the weekly TSS history.
// That is Progress's question — is the training working — not Today's.
const PANES = [
  { id: 'load', label: 'Load' },
  { id: 'erg', label: 'Erg' },
  { id: 'strength', label: 'Strength' },
  { id: 'history', label: 'History' },
];

// What each pane's tab says; PANES keeps its English for code and tests.
export const PANE_MESSAGES = {
  load: msg({ message: 'Load', comment: 'Progress sub-tab: training load' }),
  erg: msg({ message: 'Erg', comment: 'Progress sub-tab: rowing' }),
  strength: msg({ message: 'Strength', comment: 'Progress sub-tab' }),
  history: msg({
    message: 'History',
    comment: 'Progress sub-tab: past sessions',
  }),
};

export { PANES };

function ErgPane({ onLog }) {
  const { data: tssHistory } = useTSSHistory();
  const load = useMemo(
    () => (tssHistory?.length ? calcTrainingLoad(tssHistory) : []),
    [tssHistory]
  );
  const latest = load[load.length - 1] ?? null;
  return (
    <ErgView
      tsbNow={latest ? latest.tsb : null}
      ctlNow={latest ? latest.ctl : null}
      heading={false}
      onLog={onLog}
    />
  );
}

// The pane is Progress's own state. `initialPane` (read once, on mount) lets
// Back from a session page land where it was opened from; `onPane` reports
// each change so the shell knows that place. Both are optional.
export default function MobileProgress({ onOpenTrain, initialPane, onPane }) {
  const { t, i18n } = useLingui();
  const [pane, setPaneState] = useState(() =>
    PANES.some((p) => p.id === initialPane) ? initialPane : PANES[0].id
  );
  const setPane = (next) => {
    setPaneState(next);
    onPane?.(next);
  };

  let body = (
    <MobileAnalytics
      heading={false}
      onOpenHistory={() => setPane('history')}
      onOpenTrain={() => onOpenTrain?.()}
    />
  );
  if (pane === 'erg') body = <ErgPane onLog={() => onOpenTrain?.()} />;
  else if (pane === 'strength')
    body = <MobileStrength onLog={() => onOpenTrain?.()} />;
  else if (pane === 'history') body = <MobileSessionLog />;

  return (
    <div
      style={{
        background: THEME.bg,
        minHeight: '100vh',
        padding: `0 ${SPACE.lg}px`,
      }}
    >
      <ScreenHeader title={i18n._(PANE_MESSAGES[pane])} />
      <SegmentedControl
        label={t`Progress`}
        value={pane}
        onChange={setPane}
        items={PANES.map((p) => ({
          id: p.id,
          label: i18n._(PANE_MESSAGES[p.id]),
        }))}
      />
      {body}
      {/* Progress is where the user reviews whether the log is complete, so the
          import's health belongs at the foot of it. Deliberately NOT a sixth
          destination — DESTINATIONS is the fixed five from DESIGN_BRIEF.md §2.2.
          Strava is the owner's own account: not on a testers build (#793). */}
      {!isTestersBuild() && <StravaConnectPanel compact />}
    </div>
  );
}
