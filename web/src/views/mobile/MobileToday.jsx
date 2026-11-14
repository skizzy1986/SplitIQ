import React, { useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useSessions } from '../../hooks/useSessions.js';
import { useVitals } from '../../hooks/useVitals.js';
import { useTSSHistory } from '../../hooks/useTSSHistory.js';
import { useAnchors } from '../../hooks/useAnchors.js';
import {
  calcTrainingLoad,
  sessionLoad,
  tsbBand,
  TSB_BAND_MESSAGES,
} from '../../utils/trainingLoad.js';
import { readinessStatusText } from '../../utils/recoveryAnalytics.js';
import { durationLabel } from '../../utils/durationLabel.js';
import { dateLocale } from '../../utils/displayLocale.js';
import { toISODate, toLogDate } from '../../utils/dateFormat.js';
import {
  COMPLETED_STATUSES,
  PLANNED_STATUS,
} from '../../constants/sessionStatus.js';
import { THEME } from '../../constants/theme.js';
import SharedCard from '../../components/Card.jsx';
import ScreenHeader from '../../components/ScreenHeader.jsx';
import Button from '../../components/Button.jsx';
import ListRow from '../../components/ListRow.jsx';
import StatTile from '../../components/StatTile.jsx';
import SectionHeader from '../../components/SectionHeader.jsx';
import { FONT } from '../../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';

// Today answers one question: what am I doing right now, and am I in any state
// to do it. Layout follows designs/today.html — readiness first, then the
// session, then the week, then what just happened.
//
// Every number here is derived. HANDOFF.md's house rule: any caption stating a
// count, rank or comparison is computed, never typed, because a hardcoded
// "3rd best this month" is wrong the day after it is written.

const Label = ({ children, style }) => (
  <div
    style={{
      fontSize: TYPE.micro.size,
      fontWeight: TYPE.micro.weight,
      letterSpacing: TYPE.micro.letterSpacing,
      color: THEME.textSubtle,
      ...style,
    }}
  >
    {children}
  </div>
);

const Card = SharedCard;

export default function MobileToday({ onStartSession, onOpenBody }) {
  const { t, i18n } = useLingui();
  const { data: sessions } = useSessions();
  const { readiness } = useVitals();
  const { data: tssHistory, isLoading: loadPending } = useTSSHistory();
  const { anchors, cp } = useAnchors();

  // toISODate only parses the text sessions.date stores; it returns '' for a
  // Date. toLogDate is its inverse and reads LOCAL calendar fields, so this
  // composition also avoids the UTC day-shift either side of midnight.
  const today = toISODate(toLogDate(new Date()));

  const load = useMemo(
    () => (tssHistory?.length ? calcTrainingLoad(tssHistory) : []),
    [tssHistory]
  );
  const latestLoad = load[load.length - 1] ?? null;
  const band = tsbBand(latestLoad?.tsb);

  const { todays, week, recent } = useMemo(() => {
    const all = sessions ?? [];
    const withIso = all.map((s) => ({ ...s, iso: toISODate(s.date) }));

    // Monday-anchored, matching the microcycle the programme is written in.
    const now = new Date(`${today}T00:00:00`);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = toISODate(toLogDate(monday));

    const inWeek = withIso.filter((s) => s.iso >= weekStart && s.iso <= today);
    const done = inWeek.filter((s) => COMPLETED_STATUSES.includes(s.status));

    return {
      todays: withIso.filter((s) => s.iso === today),
      week: {
        done: done.length,
        planned: withIso.filter(
          (s) => s.iso >= weekStart && s.status === PLANNED_STATUS
        ).length,
        tss: Math.round(
          done.reduce((sum, s) => sum + (sessionLoad(s, { cp }) ?? 0), 0)
        ),
      },
      recent: withIso
        .filter((s) => COMPLETED_STATUSES.includes(s.status) && s.iso < today)
        .sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0))
        .slice(0, 3),
    };
  }, [sessions, today, cp]);

  const prescribed = todays.find((s) => s.status === PLANNED_STATUS) ?? null;
  const phase = anchors?.current_phase?.value ?? null;
  const block = anchors?.current_block?.value ?? null;

  return (
    <div
      style={{
        padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px`,
        background: THEME.bg,
        minHeight: '100vh',
      }}
    >
      <ScreenHeader
        title={<Trans>Today</Trans>}
        meta={new Date(`${today}T00:00:00`).toLocaleDateString(
          dateLocale(i18n.locale, 'en-GB'),
          {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }
        )}
      />
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: SPACE.sm,
          marginBottom: SPACE.md,
        }}
      >
        {phase && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: TYPE.caption.size,
              fontFamily: FONT.mono,
              color: THEME.accent,
              background: THEME.surface,
              border: `1px solid ${THEME.border}`,
              borderRadius: RADIUS.pill,
              padding: `2px ${SPACE.sm}px`,
            }}
          >
            {[phase, block].filter(Boolean).join(' · ').toUpperCase()}
          </span>
        )}
      </header>

      <Card>
        <Label>
          <Trans comment="Card heading, all capitals">READINESS</Trans>
        </Label>
        {readiness?.score == null ? (
          // computeReadiness returns null when RHR is missing. That is a real
          // state and must not render as a zero or a confident low score.
          <>
            <div
              style={{
                fontSize: TYPE.title.size,
                fontWeight: TYPE.title.weight,
                color: THEME.muted,
                marginTop: SPACE.xs,
              }}
            >
              <Trans>No reading this morning</Trans>
            </div>
            <div
              style={{
                fontSize: TYPE.bodySm.size,
                color: THEME.muted,
                marginTop: SPACE.xs,
              }}
            >
              <Trans comment="Body is the name of a tab in the app">
                Readiness needs a resting heart rate. Sync vitals from Body.
              </Trans>
            </div>
            <Button onClick={() => onOpenBody?.()}>
              <Trans>Open Body</Trans>
            </Button>
          </>
        ) : (
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap: SPACE.lg }}
          >
            <div>
              <div
                style={{
                  fontSize: TYPE.hero.size,
                  fontWeight: TYPE.hero.weight,
                  letterSpacing: TYPE.hero.letterSpacing,
                  lineHeight: TYPE.hero.lineHeight,
                  fontFamily: FONT.mono,
                  color: THEME.text,
                }}
              >
                {readiness.score}
              </div>
              <div
                style={{
                  fontSize: TYPE.body.size,
                  fontWeight: TYPE.label.weight,
                  color: THEME.text,
                  marginTop: SPACE.xs,
                }}
              >
                {readinessStatusText(i18n, readiness.status)}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <Label>
                <Trans comment="Training form (TSB), all capitals">FORM</Trans>
              </Label>
              <div
                style={{
                  fontSize: TYPE.title.size,
                  fontWeight: TYPE.title.weight,
                  fontFamily: FONT.mono,
                  color: THEME[band?.token] ?? THEME.muted,
                }}
              >
                {latestLoad
                  ? latestLoad.tsb.toFixed(1)
                  : loadPending
                    ? t`Reading…`
                    : t`No reading`}
              </div>
              <div style={{ fontSize: TYPE.caption.size, color: THEME.muted }}>
                {band
                  ? i18n._(TSB_BAND_MESSAGES[band.key])
                  : loadPending
                    ? t`Reading…`
                    : t`No reading`}
              </div>
            </div>
          </div>
        )}
        {readiness?.score != null && readiness?.partial && (
          <div
            style={{
              fontSize: TYPE.caption.size,
              color: THEME.muted,
              marginTop: SPACE.sm,
            }}
          >
            <Trans>
              Scored on the readings that arrived — some were missing.
            </Trans>
          </div>
        )}
      </Card>

      <SectionHeader>
        <Trans comment="Section heading, all capitals">TODAY</Trans>
      </SectionHeader>
      {todays.length === 0 ? (
        <Card>
          <div style={{ fontSize: TYPE.body.size, color: THEME.muted }}>
            <Trans>Nothing prescribed today.</Trans>
          </div>
          <Button onClick={() => onStartSession?.()}>
            <Trans>Open Train</Trans>
          </Button>
        </Card>
      ) : (
        todays.map((s) => (
          <Card key={s.id} accent={THEME.accent}>
            <div
              style={{
                fontSize: TYPE.title.size,
                fontWeight: TYPE.title.weight,
                letterSpacing: TYPE.title.letterSpacing,
                color: THEME.text,
              }}
            >
              {s.label ?? s.type}
            </div>
            {s.coach_note && (
              <div
                style={{
                  fontSize: TYPE.bodySm.size,
                  color: THEME.muted,
                  marginTop: SPACE.xs,
                  lineHeight: TYPE.bodySm.lineHeight,
                }}
              >
                {s.coach_note}
              </div>
            )}
            {s === prescribed && (
              <button
                onClick={() => onStartSession?.()}
                style={{
                  marginTop: SPACE.md,
                  width: '100%',
                  background: THEME.accent,
                  color: THEME.surface,
                  border: 'none',
                  borderRadius: RADIUS.sm,
                  padding: `${SPACE.md}px`,
                  fontSize: TYPE.label.size,
                  fontWeight: TYPE.label.weight,
                  letterSpacing: TYPE.label.letterSpacing,
                  fontFamily: FONT.sans,
                  cursor: 'pointer',
                }}
              >
                <Trans comment="Button, all capitals">START SESSION</Trans>
              </button>
            )}
          </Card>
        ))
      )}

      <SectionHeader>
        <Trans comment="Section heading, all capitals">THIS WEEK</Trans>
      </SectionHeader>
      <Card>
        <div style={{ display: 'flex', gap: SPACE.xl }}>
          <div>
            <div
              style={{
                fontSize: TYPE.display.size,
                fontWeight: TYPE.display.weight,
                fontFamily: FONT.mono,
                color: THEME.text,
              }}
            >
              {week.done}
              <span style={{ color: THEME.muted }}>
                /{week.done + week.planned}
              </span>
            </div>
            <Label style={{ marginTop: SPACE.xs }}>
              <Trans comment="Stat label, all capitals">SESSIONS</Trans>
            </Label>
          </div>
          <StatTile
            label={
              <Trans comment="Stat label, all capitals; TSS stays as is">
                TSS LOGGED
              </Trans>
            }
            value={week.tss}
          />
        </div>
      </Card>

      <SectionHeader>
        <Trans comment="Section heading, all capitals">RECENT</Trans>
      </SectionHeader>
      {recent.length === 0 ? (
        <Card>
          <div style={{ fontSize: TYPE.body.size, color: THEME.muted }}>
            <Trans>No sessions logged yet.</Trans>
          </div>
          <Button variant="secondary" onClick={() => onStartSession?.()}>
            <Trans>Open Train</Trans>
          </Button>
        </Card>
      ) : (
        <Card>
          {recent.map((s) => (
            <ListRow
              key={s.id}
              title={s.label ?? s.type}
              meta={`${durationLabel(s.duration, i18n)}${s.srpe ? ` · RPE ${s.srpe}` : ''}`}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
