import { useEffect, useMemo, useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useSessionDetail } from '../hooks/useSessionDetail.js';
import { useSessionSeries } from '../hooks/useSessionSeries.js';
import { useAnchors } from '../hooks/useAnchors.js';
import { useSessions } from '../hooks/useSessions.js';
import {
  derivePaceZones,
  deriveCyclingZones,
} from '../constants/trainingConfig.js';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';
import { formatPace } from '../utils/pace.js';
import { isCompletedStatus } from '../utils/sessionStatus.js';
import { toISODate } from '../utils/dateFormat.js';
import {
  recentPowerBaseline,
  sessionSport,
  storedSummary,
} from '../utils/sessionPage.js';
import {
  downsample,
  rangeStats,
  seriesExtras,
} from '../utils/sessionSeries.js';
import { dominantZone, timeInZones } from '../utils/sessionAnalysis.js';
import { sessionLoadBasis } from '../utils/trainingLoad.js';
import SectionHeader from '../components/SectionHeader.jsx';
import SessionSummary from '../components/session/SessionSummary.jsx';
import SessionTrace from '../components/session/SessionTrace.jsx';
import ZoneBar from '../components/session/ZoneBar.jsx';
import ProvenanceNote from '../components/session/ProvenanceNote.jsx';
import SessionState from '../components/session/SessionState.jsx';
import { zoneLabel } from '../components/session/zoneLabels.js';

const backStyle = {
  minHeight: 44,
  padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.sm,
  border: `1px solid ${THEME.border}`,
  background: 'transparent',
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  cursor: 'pointer',
};

function Skeleton({ label, height = 120 }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      role="status"
      style={{
        height,
        borderRadius: RADIUS.md,
        background: THEME.raised,
        margin: `${SPACE.md}px 0`,
      }}
    />
  );
}

// One session, explained: a plain headline, the stored summary and how it was
// scored, the trace across the session and time in the athlete's own zones.
// Source-neutral: the series arrives through useSessionSeries, whatever
// produced it. One view for both shells; `layout` only changes density.
export default function SessionView({
  sessionId,
  onBack,
  backLabel,
  layout = 'desktop',
}) {
  const { t, i18n } = useLingui();
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const detail = useSessionDetail(sessionId);
  const anchors = useAnchors();
  const history = useSessions({ mode: 'all' });
  const session = detail.data ?? null;
  const sport = sessionSport(session?.type);
  const opens = !!session && !!sport && isCompletedStatus(session.status);
  const seriesState = useSessionSeries(opens ? session : null);
  const series = seriesState.state === 'ready' ? seriesState.series : null;

  const cp = anchors.cp ?? null;
  const ftp = anchors.ftp ?? null;
  const anchorValue = sport === 'cycling' ? ftp : cp;
  const anchor = sport
    ? {
        kind: sport === 'cycling' ? 'ftp' : 'cp',
        value: anchorValue,
        status: sport === 'cycling' ? anchors.ftpStatus : anchors.cpStatus,
      }
    : null;

  const zones = useMemo(() => {
    if (!(anchorValue > 0)) return null;
    return sport === 'cycling'
      ? deriveCyclingZones(anchorValue)
      : derivePaceZones(anchorValue);
  }, [sport, anchorValue]);

  const computed = useMemo(() => {
    if (!series || !sport) return null;
    return {
      rows: downsample(series, sport),
      stats: rangeStats(series, sport),
      extras: seriesExtras(series),
    };
  }, [series, sport]);

  const zoneResult = useMemo(
    () => (series && zones ? timeInZones(series, zones) : null),
    [series, zones]
  );

  const summary = useMemo(
    () => (session && sport ? storedSummary(session, sport) : null),
    [session, sport]
  );
  const load = useMemo(
    () => (session ? sessionLoadBasis(session, { cp, ftp }) : null),
    [session, cp, ftp]
  );
  const baseline = useMemo(() => {
    if (!session || !sport) return null;
    const iso = session.date_iso ?? toISODate(session.date);
    return recentPowerBaseline(history.data ?? [], sport, iso);
  }, [history.data, session, sport]);

  const back = (
    <button type="button" onClick={onBack} style={backStyle}>
      {backLabel ?? t`Back`}
    </button>
  );

  const heading = (text) => (
    <h1
      ref={headingRef}
      tabIndex={-1}
      style={{
        margin: `${SPACE.md}px 0 ${SPACE.xs}px`,
        fontFamily: FONT.sans,
        fontSize: TYPE.title.size,
        fontWeight: TYPE.title.weight,
        letterSpacing: TYPE.title.letterSpacing,
        color: THEME.textStrong,
        outline: 'none',
      }}
    >
      {text}
    </h1>
  );

  const shell = (children) => (
    <article
      style={{
        fontFamily: FONT.sans,
        color: THEME.text,
        padding: layout === 'phone' ? `${SPACE.lg}px` : 0,
        maxWidth: 960,
      }}
    >
      {back}
      {children}
    </article>
  );

  if (detail.isPending) {
    return shell(
      <>
        {heading(t`Session`)}
        <Skeleton label={t`Loading the session`} height={200} />
      </>
    );
  }
  if (detail.isError) {
    return shell(
      <>
        {heading(t`Session`)}
        <SessionState kind="detail_error" onRetry={() => detail.refetch()} />
      </>
    );
  }
  if (!session) {
    return shell(
      <>
        {heading(t`Session not found`)}
        <SessionState kind="not_found" />
      </>
    );
  }
  if (!opens) {
    return shell(
      <>
        {heading(session.label || t`Session`)}
        <SessionState kind="wrong_sport" />
      </>
    );
  }

  // The headline describes; it never judges or instructs.
  const minutes = summary.minutes ? Math.round(summary.minutes) : null;
  const top = dominantZone(zoneResult);
  const zoneName = top ? zoneLabel(i18n, top) : null;
  let headline;
  if (sport === 'erg') {
    const pace = summary.pace500 ? formatPace(summary.pace500) : null;
    if (minutes && pace) {
      headline = zoneName
        ? t`${minutes} minutes of rowing at an average ${pace} /500 m, most of it in ${zoneName}.`
        : t`${minutes} minutes of rowing at an average ${pace} /500 m.`;
    } else if (minutes) {
      headline = t`${minutes} minutes of rowing.`;
    } else {
      headline = t`A rowing session.`;
    }
  } else {
    const watts = summary.avgWatts ? Math.round(summary.avgWatts) : null;
    const speed = summary.speedKmh ? summary.speedKmh.toFixed(1) : null;
    if (minutes && watts) {
      headline = zoneName
        ? t`${minutes} minutes of cycling at an average ${watts} W, most of it in ${zoneName}.`
        : t`${minutes} minutes of cycling at an average ${watts} W.`;
    } else if (minutes && speed) {
      headline = t`${minutes} minutes of cycling at an average ${speed} km/h.`;
    } else if (minutes) {
      headline = t`${minutes} minutes of cycling.`;
    } else {
      headline = t`A cycling session.`;
    }
  }

  const has = series?.has ?? {};
  const measured = [];
  if (has.power) measured.push('power');
  if (has.hr) measured.push('hr');
  if (has.rate) measured.push(sport === 'erg' ? 'strokeRate' : 'cadence');
  if (has.distance) measured.push('distance');
  const derived = [];
  if (sport === 'erg' && summary.pace500) {
    derived.push(
      summary.distanceM && summary.minutes ? 'paceDistance' : 'pacePower'
    );
  }
  if (sport === 'cycling' && summary.speedKmh) derived.push('speedDistance');
  if (zoneResult) derived.push(sport === 'cycling' ? 'zonesFtp' : 'zonesCp');
  if (load.basis === 'srpe') derived.push('loadSrpe');
  if (load.basis === 'power') derived.push('loadPower');

  const average =
    computed && sport === 'erg'
      ? computed.stats.pace500
      : (computed?.stats.avgWatts ?? null);

  let trace;
  if (seriesState.state === 'loading') {
    trace = <Skeleton label={t`Loading the trace`} />;
  } else if (seriesState.state === 'ready' && computed) {
    trace = (
      <>
        <SessionTrace
          rows={computed.rows}
          sport={sport}
          has={has}
          zones={has.power ? zones : null}
          average={average}
          durationS={computed.stats.elapsedS}
          layout={layout}
        />
        <SectionHeader>{t`Time in zone`}</SectionHeader>
        <ZoneBar result={zoneResult} anchor={anchor} hasPower={has.power} />
      </>
    );
  } else {
    trace = (
      <SessionState
        kind={seriesState.state === 'ready' ? 'none' : seriesState.state}
        reason={seriesState.reason}
        source={seriesState.source}
        retryAt={seriesState.retryAt}
        onRetry={seriesState.refetch}
      />
    );
  }

  return shell(
    <>
      {heading(session.label || t`Session`)}
      <p
        style={{
          margin: `0 0 ${SPACE.lg}px`,
          fontSize: TYPE.body.size,
          fontWeight: TYPE.body.weight,
          lineHeight: TYPE.body.lineHeight,
          color: THEME.textSubtle,
        }}
      >
        {headline}
      </p>
      <SessionSummary
        session={session}
        sport={sport}
        summary={summary}
        load={load}
        extras={computed?.extras ?? null}
        info={series?.info ?? null}
        elapsedS={series?.info.elapsedS ?? computed?.stats.elapsedS ?? null}
        baseline={baseline}
      />
      <SectionHeader>{t`Across the session`}</SectionHeader>
      {trace}
      <ProvenanceNote
        source={series?.source ?? null}
        href={series?.info.href ?? null}
        origin={series?.info.origin ?? null}
        measured={measured}
        derived={derived}
      />
    </>
  );
}
