import React, { useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ResponsiveContainer,
  ReferenceLine,
  XAxis,
} from 'recharts';
import { useVitals } from '../../hooks/useVitals.js';
import { useVitalsSync } from '../../hooks/useVitalsSync.js';
import { useTSSHistory } from '../../hooks/useTSSHistory.js';
import { calcTrainingLoad, tsbBand } from '../../utils/trainingLoad.js';
import { THEME } from '../../constants/theme.js';
import ScreenHeader from '../../components/ScreenHeader.jsx';
import Button from '../../components/Button.jsx';
import { FONT } from '../../constants/type.js';
import { dateLocale, displayChartDate } from '../../utils/displayLocale.js';

const tickStyle = { fontSize: 9, fill: THEME.muted };

export default function MobileRecovery({ onOpenSettings }) {
  const { t, i18n } = useLingui();
  const lang = i18n.locale;
  const chartDate = (d) => displayChartDate(lang, d);
  const {
    isLoading,
    latest,
    readinessScore,
    readinessLabel,
    personalBaselines,
    vitalsHistory,
    history,
    hasPersonalBaselines,
  } = useVitals();
  const {
    mutate: syncVitals,
    isPending: isSyncing,
    isError: syncFailed,
  } = useVitalsSync();
  const { data: tssHistory } = useTSSHistory();
  // No stale seed fallback, and no `?? 0`: a missing reading is not a TSB of
  // zero, which would render as a confident "neutral form".
  const loadData = useMemo(
    () => (tssHistory?.length ? calcTrainingLoad(tssHistory) : []),
    [tssHistory]
  );
  const tsbValue = loadData[loadData.length - 1]?.tsb ?? null;

  const todayStr = new Date().toLocaleDateString(dateLocale(lang, 'en-GB'), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const noReadiness = readinessScore == null;
  const readinessColor = noReadiness
    ? THEME.muted
    : readinessScore >= 80
      ? THEME.positive
      : readinessScore >= 60
        ? THEME.caution
        : THEME.critical;

  const coachingText =
    readinessLabel === 'READY'
      ? t`Train as planned`
      : readinessLabel === 'CAUTION'
        ? t`Train but monitor closely`
        : t`Prioritise recovery today`;

  const baselineLabel = hasPersonalBaselines
    ? t({
        message: 'your avg',
        comment: 'Followed by a number: your own average',
      })
    : t({
        message: 'baseline',
        comment: 'After "vs": compared with the baseline',
      });

  const trend14 = useMemo(
    () =>
      vitalsHistory.slice(-14).map((r) => ({
        ...r,
        date: r.date ? r.date.slice(5).replace('-', '/') : '',
      })),
    [vitalsHistory]
  );

  const weightData = useMemo(() => {
    const withWeight = vitalsHistory.filter((r) => r.bodyweight != null);
    if (withWeight.length < 5) return null;
    const slice = withWeight.slice(-14);
    return slice.map((r, i, arr) => {
      const window = arr.slice(Math.max(0, i - 6), i + 1);
      const sma7 =
        Math.round(
          (window.reduce((s, w) => s + w.bodyweight, 0) / window.length) * 10
        ) / 10;
      return {
        ...r,
        date: r.date ? r.date.slice(5).replace('-', '/') : '',
        sma7,
      };
    });
  }, [vitalsHistory]);

  return (
    <div
      style={{
        padding: '16px 16px 24px',
        background: THEME.bg,
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <ScreenHeader
          title={<Trans comment="Screen heading, all capitals">RECOVERY</Trans>}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => syncVitals()}
            disabled={isSyncing}
            aria-label={t`Sync now`}
            style={{
              background: 'none',
              border: 'none',
              minWidth: 44,
              minHeight: 44,
              cursor: isSyncing ? 'default' : 'pointer',
              color: isSyncing
                ? THEME.muted
                : syncFailed
                  ? THEME.critical
                  : THEME.positive,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            {isSyncing ? '…' : '↻'}
          </button>
          <span style={{ fontSize: 11, color: THEME.muted }}>{todayStr}</span>
        </span>
      </div>

      {isLoading && (
        <div
          style={{
            textAlign: 'center',
            color: THEME.muted,
            marginTop: 40,
            fontSize: 12,
          }}
        >
          <Trans>Loading…</Trans>
        </div>
      )}

      {!isLoading && !latest && (
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{ fontSize: 13, color: THEME.muted }}>
            <Trans>No vitals recorded yet</Trans>
          </div>
          <div style={{ fontSize: 11, color: THEME.muted, marginTop: 8 }}>
            <Trans comment="Google Health is a brand name: keep it">
              Connect Google Health to populate this view
            </Trans>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button onClick={() => onOpenSettings?.()}>
              <Trans>Open Settings</Trans>
            </Button>
          </div>
        </div>
      )}

      {!isLoading && latest && (
        <>
          {/* Readiness hero */}
          <div
            style={{
              background: THEME.raised,
              borderRadius: 12,
              padding: '20px',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: noReadiness ? 22 : 52,
                fontWeight: 700,
                color: readinessColor,
                fontFamily: noReadiness ? FONT.sans : FONT.mono,
                lineHeight: noReadiness ? 1.2 : 1,
              }}
            >
              {noReadiness ? t`No reading` : readinessScore}
            </div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: 2,
                color: THEME.muted,
                marginTop: 6,
              }}
            >
              <Trans comment="All capitals">READINESS</Trans>
            </div>
            {!noReadiness && (
              <div
                style={{
                  fontSize: 12,
                  color: readinessColor,
                  marginTop: 6,
                  fontWeight: 600,
                }}
              >
                {coachingText}
              </div>
            )}
          </div>

          {/* Metric tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {(() => {
              // Same rule as sleep and TSB: a missing reading is not zero, so
              // it takes no delta and no status colour (#623).
              const rhrMissing = latest.rhr == null;
              const rhrDelta = rhrMissing
                ? null
                : Math.round(
                    (latest.rhr - personalBaselines.rhrBaseline) * 10
                  ) / 10;
              const rhrColor = rhrMissing
                ? THEME.muted
                : rhrDelta > 5
                  ? THEME.critical
                  : rhrDelta > 2
                    ? THEME.caution
                    : THEME.positive;
              return (
                <div
                  style={{
                    background: THEME.raised,
                    borderRadius: 10,
                    padding: '14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: 2,
                      color: THEME.muted,
                      marginBottom: 4,
                    }}
                  >
                    <Trans comment="All capitals">RESTING HR</Trans>
                  </div>
                  <div
                    style={{ fontSize: 24, fontWeight: 700, color: rhrColor }}
                  >
                    {rhrMissing ? t`No reading` : `${latest.rhr} bpm`}
                  </div>
                  {!rhrMissing && (
                    <div
                      style={{ fontSize: 10, color: THEME.muted, marginTop: 4 }}
                    >
                      {rhrDelta > 0
                        ? '↑ +' + rhrDelta
                        : rhrDelta < 0
                          ? '↓ ' + rhrDelta
                          : '='}{' '}
                      <Trans comment="Compared with, e.g. vs your avg">
                        vs {baselineLabel}
                      </Trans>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const hrvMissing = latest.hrv == null;
              const hrvDelta = hrvMissing
                ? null
                : Math.round(
                    (latest.hrv - personalBaselines.hrvBaseline) * 10
                  ) / 10;
              const deficit = hrvDelta == null ? null : -hrvDelta;
              const hrvColor = hrvMissing
                ? THEME.muted
                : deficit < 3
                  ? THEME.positive
                  : deficit < 8
                    ? THEME.caution
                    : THEME.critical;
              return (
                <div
                  style={{
                    background: THEME.raised,
                    borderRadius: 10,
                    padding: '14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: 2,
                      color: THEME.muted,
                      marginBottom: 4,
                    }}
                  >
                    HRV
                  </div>
                  <div
                    style={{ fontSize: 24, fontWeight: 700, color: hrvColor }}
                  >
                    {hrvMissing ? t`No reading` : `${latest.hrv} ms`}
                  </div>
                  {!hrvMissing && (
                    <div
                      style={{ fontSize: 10, color: THEME.muted, marginTop: 4 }}
                    >
                      {hrvDelta >= 0 ? '↑ +' + hrvDelta : '↓ ' + deficit}{' '}
                      <Trans comment="Compared with, e.g. vs your avg">
                        vs {baselineLabel}
                      </Trans>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const sleepMissing = latest.sleep == null;
              const sleepColor = sleepMissing
                ? THEME.muted
                : latest.sleep >= 7
                  ? THEME.positive
                  : latest.sleep >= 6.5
                    ? THEME.caution
                    : THEME.critical;
              return (
                <div
                  style={{
                    background: THEME.raised,
                    borderRadius: 10,
                    padding: '14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: 2,
                      color: THEME.muted,
                      marginBottom: 4,
                    }}
                  >
                    <Trans comment="All capitals">SLEEP</Trans>
                  </div>
                  <div
                    style={{ fontSize: 24, fontWeight: 700, color: sleepColor }}
                  >
                    {latest.sleep != null ? `${latest.sleep}h` : t`No reading`}
                  </div>
                  {!sleepMissing && (
                    <div
                      style={{ fontSize: 10, color: THEME.muted, marginTop: 4 }}
                    >
                      {latest.sleep >= 7 ? t`Target met` : t`Below 7h target`}
                    </div>
                  )}
                </div>
              );
            })()}

            {latest.sleep_score != null ? (
              <div
                style={{
                  background: THEME.raised,
                  borderRadius: 10,
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: 2,
                    color: THEME.muted,
                    marginBottom: 4,
                  }}
                >
                  <Trans comment="All capitals">SLEEP SCORE</Trans>
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color:
                      latest.sleep_score >= 80
                        ? THEME.positive
                        : latest.sleep_score >= 70
                          ? THEME.caution
                          : THEME.critical,
                  }}
                >
                  {latest.sleep_score}
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: THEME.raised,
                  borderRadius: 10,
                  padding: '14px',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: 2,
                    color: THEME.muted,
                    marginBottom: 4,
                  }}
                >
                  <Trans comment="All capitals; TSB stays as is">
                    FORM / TSB
                  </Trans>
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: THEME[tsbBand(tsbValue)?.token] ?? THEME.muted,
                  }}
                >
                  {tsbValue == null ? t`No reading` : tsbValue.toFixed(1)}
                </div>
              </div>
            )}
          </div>

          {trend14.length > 0 && (
            <>
              {/* HRV 14-day trend */}
              <div
                style={{
                  background: THEME.raised,
                  borderRadius: 10,
                  padding: '14px',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: 2,
                    color: THEME.muted,
                    marginBottom: 6,
                  }}
                >
                  <Trans comment="Chart title, all capitals; HRV stays as is">
                    HRV TREND — 14 DAYS
                  </Trans>
                </div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={trend14}>
                    <XAxis
                      dataKey="date"
                      tick={tickStyle}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={chartDate}
                    />
                    <ReferenceLine
                      y={personalBaselines.hrvBaseline}
                      stroke={THEME.warning}
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="hrv"
                      stroke={THEME.accent}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {trend14.length > 0 && (
            <>
              {/* RHR 14-day trend */}
              <div
                style={{
                  background: THEME.raised,
                  borderRadius: 10,
                  padding: '14px',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: 2,
                    color: THEME.muted,
                    marginBottom: 6,
                  }}
                >
                  <Trans comment="Chart title, all capitals">
                    RESTING HR TREND — 14 DAYS
                  </Trans>
                </div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={trend14}>
                    <XAxis
                      dataKey="date"
                      tick={tickStyle}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={chartDate}
                    />
                    <ReferenceLine
                      y={personalBaselines.rhrBaseline}
                      stroke={THEME.accent}
                      strokeDasharray="3 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="rhr"
                      stroke={THEME.warning}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {trend14.length > 0 && (
            <>
              {/* Sleep 14-day bar chart */}
              <div
                style={{
                  background: THEME.raised,
                  borderRadius: 10,
                  padding: '14px',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: 2,
                    color: THEME.muted,
                    marginBottom: 6,
                  }}
                >
                  <Trans comment="Chart title, all capitals">
                    SLEEP — 14 DAYS
                  </Trans>
                </div>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={trend14} barCategoryGap="20%">
                    <ReferenceLine
                      y={7}
                      stroke={THEME.positive}
                      strokeDasharray="3 3"
                    />
                    <Bar
                      dataKey="sleep"
                      fill={THEME.accentAlt}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {/* 7-day readiness history */}
          {history.length > 0 && (
            <div
              style={{
                background: THEME.raised,
                borderRadius: 10,
                padding: '14px',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: 2,
                  color: THEME.muted,
                  marginBottom: 6,
                }}
              >
                <Trans comment="Chart title, all capitals">
                  READINESS — 7 DAYS
                </Trans>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={history.slice(-7)}>
                  <ReferenceLine
                    y={80}
                    stroke={THEME.positive}
                    strokeDasharray="3 3"
                  />
                  <ReferenceLine
                    y={60}
                    stroke={THEME.caution}
                    strokeDasharray="3 3"
                  />
                  <Line
                    type="monotone"
                    dataKey="readinessScore"
                    stroke={THEME.accent}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bodyweight trend (only when ≥5 data points) */}
          {weightData && (
            <div
              style={{
                background: THEME.raised,
                borderRadius: 10,
                padding: '14px',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: 2,
                  color: THEME.muted,
                  marginBottom: 6,
                }}
              >
                <Trans comment="Chart title, all capitals; kg stays as is">
                  BODYWEIGHT — 14 DAYS (kg)
                </Trans>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={weightData}>
                  <Line
                    type="monotone"
                    dataKey="bodyweight"
                    stroke={THEME.caution}
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="sma7"
                    stroke={THEME.caution}
                    strokeOpacity={0.53}
                    strokeDasharray="4 4"
                    dot={false}
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
