import React, { useMemo, lazy, Suspense } from 'react';
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
import { isTestersBuild } from '../../utils/testersBuild.js';
import SharedCard from '../../components/Card.jsx';
import ScreenHeader from '../../components/ScreenHeader.jsx';
import Button from '../../components/Button.jsx';
import ListRow from '../../components/ListRow.jsx';
import StatTile from '../../components/StatTile.jsx';
import SectionHeader from '../../components/SectionHeader.jsx';
import { FONT } from '../../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { readLiveErgFlag } from '../../live-erg/liveErgFlag.js';
import SampleDataBadge from '../../components/SampleDataBadge.jsx';

const TestersWelcomeCard = lazy(
  () => import('../../components/TestersWelcomeCard.jsx')
);

// Today answers one question: what am I doing right now, and am I in any
// state to do it. Home A (#771): the planned session and Start on PM5 lead,
// then a compact readiness/form glance, this week, the last row, and recent.
//
// Every number here is derived. HANDOFF.md's house rule: any caption stating a
// count, rank or comparison is computed, never typed, because a hardcoded
// "3rd best this month" is wrong the day after it is written.

export const START_PLANNED = 'planned';
export const START_AGAIN = 'again';
export const START_JUST_ROW = 'just-row';
export const START_PICK = 'pick';
export const START_TWEAK = 'tweak';

export function isErgSessionType(type) {
  const t = (type ?? '').toLowerCase();
  return t.includes('erg') || t.includes('row');
}

function sessionFacts(session, i18n) {
  const parts = [];
  if (session.avg_watts != null) parts.push(`${session.avg_watts} W`);
  const duration = durationLabel(session.duration, i18n);
  if (duration) parts.push(duration);
  if (session.distance_m != null) {
    parts.push(`${(session.distance_m / 1000).toFixed(1)} km`);
  }
  return parts.join(' · ');
}

const Label = ({ children, style }) => (
  <div
    style={{
      fontSize: TYPE.label.size,
      fontWeight: TYPE.label.weight,
      letterSpacing: TYPE.label.letterSpacing,
      color: THEME.textSubtle,
      ...style,
    }}
  >
    {children}
  </div>
);

const Card = SharedCard;

function StartButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: 56,
        marginTop: SPACE.md,
        padding: `0 ${SPACE.lg}px`,
        background: THEME.accent,
        color: THEME.onAccent,
        border: 'none',
        borderRadius: RADIUS.md,
        fontSize: TYPE.title.size,
        fontWeight: TYPE.title.weight,
        fontFamily: FONT.sans,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryRow({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: SPACE.sm,
        marginTop: SPACE.sm,
      }}
    >
      {children}
    </div>
  );
}

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

  const { todays, week, recent, lastErg } = useMemo(() => {
    const all = sessions ?? [];
    const withIso = all.map((s) => ({ ...s, iso: toISODate(s.date) }));

    // Monday-anchored, matching the microcycle the programme is written in.
    const now = new Date(`${today}T00:00:00`);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = toISODate(toLogDate(monday));

    const inWeek = withIso.filter((s) => s.iso >= weekStart && s.iso <= today);
    const done = inWeek.filter((s) => COMPLETED_STATUSES.includes(s.status));

    const completedErgs = withIso
      .filter(
        (s) => COMPLETED_STATUSES.includes(s.status) && isErgSessionType(s.type)
      )
      .sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));

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
      lastErg: completedErgs[0] ?? null,
    };
  }, [sessions, today, cp]);

  const prescribed = todays.find((s) => s.status === PLANNED_STATUS) ?? null;
  const doneToday = todays.filter((s) => COMPLETED_STATUSES.includes(s.status));
  const phase = anchors?.current_phase?.value ?? null;
  const block = anchors?.current_block?.value ?? null;
  const phaseLabel = phase
    ? [phase, block].filter(Boolean).join(' · ').toUpperCase()
    : null;

  const start = (intent) => onStartSession?.(intent);
  // With the v10 live screen on, this opens the interval planner, not an
  // editor for today's prescribed sessions row. Say so on the button.
  const labsLiveErg = readLiveErgFlag();

  const dateMeta = new Date(`${today}T00:00:00`).toLocaleDateString(
    dateLocale(i18n.locale, 'en-GB'),
    {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }
  );

  const formValue = latestLoad
    ? latestLoad.tsb.toFixed(1)
    : loadPending
      ? t`Reading…`
      : t`No reading`;
  const formBand = band
    ? i18n._(TSB_BAND_MESSAGES[band.key])
    : loadPending
      ? t`Reading…`
      : t`No reading`;

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
        meta={
          <>
            {dateMeta}
            {phaseLabel && (
              <span
                style={{
                  marginLeft: SPACE.sm,
                  fontFamily: FONT.mono,
                  color: THEME.text,
                }}
              >
                {phaseLabel}
              </span>
            )}
          </>
        }
      />

      {isTestersBuild() && (
        <Suspense fallback={null}>
          <TestersWelcomeCard />
        </Suspense>
      )}

      <Card>
        {prescribed ? (
          <>
            <Label>
              <Trans comment="Card eyebrow, all capitals">
                TODAY'S SESSION · PLANNED
              </Trans>
            </Label>
            <div
              style={{
                fontSize: TYPE.title.size,
                fontWeight: TYPE.title.weight,
                letterSpacing: TYPE.title.letterSpacing,
                color: THEME.text,
                marginTop: SPACE.xs,
              }}
            >
              {prescribed.label ?? prescribed.type}
              <SampleDataBadge session={prescribed} locale={i18n.locale} />
            </div>
            {sessionFacts(prescribed, i18n) && (
              <div
                style={{
                  fontSize: TYPE.bodySm.size,
                  fontFamily: FONT.mono,
                  color: THEME.text,
                  marginTop: SPACE.xs,
                }}
              >
                {sessionFacts(prescribed, i18n)}
              </div>
            )}
            {prescribed.coach_note && (
              <div
                style={{
                  fontSize: TYPE.bodySm.size,
                  color: THEME.muted,
                  marginTop: SPACE.xs,
                  lineHeight: TYPE.bodySm.lineHeight,
                }}
              >
                {prescribed.coach_note}
              </div>
            )}
            <StartButton onClick={() => start(START_PLANNED)}>
              <Trans>Start on PM5</Trans>
            </StartButton>
            <SecondaryRow>
              <Button variant="secondary" onClick={() => start(START_TWEAK)}>
                {labsLiveErg ? (
                  <Trans>Plan intervals</Trans>
                ) : (
                  <Trans>Tweak</Trans>
                )}
              </Button>
              <Button variant="secondary" onClick={() => start(START_JUST_ROW)}>
                <Trans>Just row</Trans>
              </Button>
            </SecondaryRow>
          </>
        ) : lastErg ? (
          <>
            <Label>
              <Trans comment="Card eyebrow, all capitals">
                NOTHING PLANNED TODAY
              </Trans>
            </Label>
            <div
              style={{
                fontSize: TYPE.title.size,
                fontWeight: TYPE.title.weight,
                letterSpacing: TYPE.title.letterSpacing,
                color: THEME.text,
                marginTop: SPACE.xs,
              }}
            >
              <Trans>Row your last piece again?</Trans>
            </div>
            <div
              style={{
                fontSize: TYPE.bodySm.size,
                fontFamily: FONT.mono,
                color: THEME.text,
                marginTop: SPACE.xs,
              }}
            >
              {lastErg.label ?? lastErg.type}
              <SampleDataBadge session={lastErg} locale={i18n.locale} />
              {sessionFacts(lastErg, i18n)
                ? ` · ${sessionFacts(lastErg, i18n)}`
                : ''}
            </div>
            <StartButton onClick={() => start(START_AGAIN)}>
              <Trans>Row it again</Trans>
            </StartButton>
            <SecondaryRow>
              <Button variant="secondary" onClick={() => start(START_JUST_ROW)}>
                <Trans>Just row</Trans>
              </Button>
              <Button variant="secondary" onClick={() => start(START_PICK)}>
                <Trans>Pick a workout</Trans>
              </Button>
            </SecondaryRow>
          </>
        ) : (
          <>
            <Label>
              <Trans comment="Card eyebrow, all capitals">
                NOTHING PLANNED TODAY
              </Trans>
            </Label>
            <div
              style={{
                fontSize: TYPE.body.size,
                color: THEME.muted,
                marginTop: SPACE.xs,
              }}
            >
              <Trans>No previous erg piece to repeat.</Trans>
            </div>
            <StartButton onClick={() => start(START_JUST_ROW)}>
              <Trans>Just row</Trans>
            </StartButton>
            <SecondaryRow>
              <Button variant="secondary" onClick={() => start(START_PICK)}>
                <Trans>Pick a workout</Trans>
              </Button>
            </SecondaryRow>
          </>
        )}
      </Card>

      {doneToday.map((s) => (
        <Card key={s.id}>
          <div
            style={{
              fontSize: TYPE.title.size,
              fontWeight: TYPE.title.weight,
              letterSpacing: TYPE.title.letterSpacing,
              color: THEME.text,
            }}
          >
            {s.label ?? s.type}
            <SampleDataBadge session={s} locale={i18n.locale} />
          </div>
          {sessionFacts(s, i18n) && (
            <div
              style={{
                fontSize: TYPE.bodySm.size,
                fontFamily: FONT.mono,
                color: THEME.muted,
                marginTop: SPACE.xs,
              }}
            >
              {sessionFacts(s, i18n)}
            </div>
          )}
        </Card>
      ))}

      {!isTestersBuild() && (
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
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: SPACE.lg,
                marginTop: SPACE.xs,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: TYPE.display.size,
                    fontWeight: TYPE.display.weight,
                    letterSpacing: TYPE.display.letterSpacing,
                    lineHeight: TYPE.display.lineHeight,
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
                  <Trans comment="Training form (TSB), all capitals">
                    FORM
                  </Trans>
                </Label>
                <div
                  style={{
                    fontSize: TYPE.title.size,
                    fontWeight: TYPE.title.weight,
                    fontFamily: FONT.mono,
                    color: THEME[band?.token] ?? THEME.muted,
                  }}
                >
                  {formValue}
                </div>
                <div
                  style={{ fontSize: TYPE.caption.size, color: THEME.muted }}
                >
                  {formBand}
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

      {lastErg && (
        <>
          <SectionHeader>
            <Trans comment="Section heading, all capitals">LAST ROW</Trans>
          </SectionHeader>
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: SPACE.sm,
              }}
            >
              <div
                style={{
                  fontSize: TYPE.body.size,
                  fontWeight: TYPE.label.weight,
                  color: THEME.text,
                }}
              >
                {lastErg.label ?? lastErg.type}
                <SampleDataBadge session={lastErg} locale={i18n.locale} />
              </div>
              <div
                style={{
                  fontSize: TYPE.caption.size,
                  color: THEME.textFaint,
                }}
              >
                {lastErg.iso
                  ? new Date(`${lastErg.iso}T00:00:00`).toLocaleDateString(
                      dateLocale(i18n.locale, 'en-GB'),
                      { day: 'numeric', month: 'short' }
                    )
                  : ''}
              </div>
            </div>
            {sessionFacts(lastErg, i18n) && (
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: TYPE.body.size,
                  marginTop: SPACE.sm,
                  color: THEME.textStrong,
                }}
              >
                {sessionFacts(lastErg, i18n)}
                {lastErg.srpe != null ? ` · sRPE ${lastErg.srpe}` : ''}
              </div>
            )}
          </Card>
        </>
      )}

      <SectionHeader>
        <Trans comment="Section heading, all capitals">RECENT</Trans>
      </SectionHeader>
      {recent.length === 0 ? (
        <Card>
          <div style={{ fontSize: TYPE.body.size, color: THEME.muted }}>
            <Trans>No sessions logged yet.</Trans>
          </div>
          <Button variant="secondary" onClick={() => start(START_PICK)}>
            <Trans>Open Train</Trans>
          </Button>
        </Card>
      ) : (
        <Card>
          {recent.map((s) => (
            <ListRow
              key={s.id}
              title={
                <>
                  {s.label ?? s.type}
                  <SampleDataBadge session={s} locale={i18n.locale} />
                </>
              }
              meta={`${durationLabel(s.duration, i18n)}${s.srpe ? ` · RPE ${s.srpe}` : ''}`}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
