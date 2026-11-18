import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
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
  recentHrBaseline,
  recentPowerBaseline,
  sessionSport,
  storedSummary,
} from '../utils/sessionPage.js';
import {
  CYCLING_SPLIT_M,
  ROWING_SPLIT_M,
  ROWING_SPLIT_OPTIONS,
  distanceSplits,
  downsample,
  indexRangeForTimes,
  lapSplits,
  rangeStats,
  seriesExtras,
} from '../utils/sessionSeries.js';
import {
  aerobicDrift,
  analysisNeeds,
  dominantZone,
  peakPowers,
  timeInZones,
  variabilityIndex,
} from '../utils/sessionAnalysis.js';
import { sessionLoadBasis } from '../utils/trainingLoad.js';
import SectionHeader from '../components/SectionHeader.jsx';
import SessionSummary from '../components/session/SessionSummary.jsx';
import SessionTrace from '../components/session/SessionTrace.jsx';
import ZoneBar from '../components/session/ZoneBar.jsx';
import ProvenanceNote from '../components/session/ProvenanceNote.jsx';
import SessionState from '../components/session/SessionState.jsx';
import RangeSummary from '../components/session/RangeSummary.jsx';
import SplitsTable from '../components/session/SplitsTable.jsx';
import MoreDetail from '../components/session/MoreDetail.jsx';
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
// scored, the trace across the session and time in the athlete's own zones,
// then its splits and, behind "More detail", peak powers, variability and
// drift. A stretch selected on the trace or in the splits is summarised under
// the trace.
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
  // 'all', not 'recent': 'recent' is the newest 50 rows, which cannot hold
  // the 30 days before an older session. 'all' is the same cached query both
  // shells' History lists already load, so opening a page from History costs
  // no extra read.
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
  const hrBaseline = useMemo(() => {
    if (!session || !sport) return null;
    const iso = session.date_iso ?? toISODate(session.date);
    return recentHrBaseline(history.data ?? [], sport, iso);
  }, [history.data, session, sport]);

  // Splits: rowing by distance (the athlete picks 500 m, 1 km or 2 km);
  // cycling by recorded lap when there is more than one, else by 5 km.
  const [rowingSplitM, setRowingSplitM] = useState(ROWING_SPLIT_M);
  const splitView = useMemo(() => {
    if (!series || !sport) return null;
    if (sport === 'erg') {
      return {
        mode: 'distance',
        splitM: rowingSplitM,
        splits: distanceSplits(series, sport, rowingSplitM),
      };
    }
    const laps = lapSplits(series, sport);
    if (laps.length) return { mode: 'laps', splitM: null, splits: laps };
    return {
      mode: 'distance',
      splitM: CYCLING_SPLIT_M,
      splits: distanceSplits(series, sport, CYCLING_SPLIT_M),
    };
  }, [series, sport, rowingSplitM]);

  const analysis = useMemo(
    () =>
      series
        ? {
            peaks: peakPowers(series),
            variability: variabilityIndex(series),
            drift: aerobicDrift(series),
            needs: analysisNeeds(series),
          }
        : null,
    [series]
  );

  // The selected stretch: a dragged range of samples or a split. It belongs
  // to the series it was made on, so a new series starts unselected.
  const [selection, setSelection] = useState(null);
  const clearSelection = useCallback(() => setSelection(null), []);
  const live = selection && selection.series === series ? selection : null;
  const selectedSplit =
    live?.kind === 'split' ? (splitView?.splits[live.index] ?? null) : null;
  let selected = null;
  if (live?.kind === 'range') {
    const stats = rangeStats(series, sport, live.i0, live.i1);
    const t0 = series.t[0];
    selected = {
      from: 'trace',
      stats,
      area: { x0: series.t[stats.i0] - t0, x1: series.t[stats.i1] - t0 },
    };
  } else if (selectedSplit) {
    selected = {
      from: 'split',
      stats: selectedSplit,
      area: { x0: selectedSplit.startS, x1: selectedSplit.endS },
    };
  }
  const onSelectRange = useCallback(
    (x0, x1) => {
      if (!series) return;
      const t0 = series.t[0];
      const { i0, i1 } = indexRangeForTimes(series, t0 + x0, t0 + x1);
      setSelection({ series, kind: 'range', i0, i1 });
    },
    [series]
  );
  const onSelectSplit = (index) =>
    setSelection(index == null ? null : { series, kind: 'split', index });
  const onSplitM = (m) => {
    setRowingSplitM(m);
    if (live?.kind === 'split') setSelection(null);
  };
  const hasSelection = selected != null;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSelection(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasSelection]);

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
    if (minutes && pace && zoneName) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: `# minute of rowing at an average ${pace} /500 m, most of it in ${zoneName}.`,
          other: `# minutes of rowing at an average ${pace} /500 m, most of it in ${zoneName}.`,
        }),
      });
    } else if (minutes && pace) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: `# minute of rowing at an average ${pace} /500 m.`,
          other: `# minutes of rowing at an average ${pace} /500 m.`,
        }),
      });
    } else if (minutes) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: '# minute of rowing.',
          other: '# minutes of rowing.',
        }),
      });
    } else {
      headline = t`A rowing session.`;
    }
  } else {
    const watts = summary.avgWatts ? Math.round(summary.avgWatts) : null;
    const speed = summary.speedKmh ? summary.speedKmh.toFixed(1) : null;
    if (minutes && watts && zoneName) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: `# minute of cycling at an average ${watts} W, most of it in ${zoneName}.`,
          other: `# minutes of cycling at an average ${watts} W, most of it in ${zoneName}.`,
        }),
      });
    } else if (minutes && watts) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: `# minute of cycling at an average ${watts} W.`,
          other: `# minutes of cycling at an average ${watts} W.`,
        }),
      });
    } else if (minutes && speed) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: `# minute of cycling at an average ${speed} km/h.`,
          other: `# minutes of cycling at an average ${speed} km/h.`,
        }),
      });
    } else if (minutes) {
      headline = t({
        comment: 'Session headline; # is the number of minutes',
        message: plural(minutes, {
          one: '# minute of cycling.',
          other: '# minutes of cycling.',
        }),
      });
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

  // One average per quantity on the page: the dashed line on each chart is
  // the figure the summary tile shows (the stored row), and only when the row
  // has none does it fall back to the trace's own average.
  const averages = computed
    ? {
        first:
          sport === 'erg'
            ? (summary.pace500 ?? computed.stats.pace500)
            : (summary.avgWatts ?? computed.stats.avgWatts),
        hr: summary.avgHr ?? computed.stats.avgHr,
        rate: computed.stats.avgRate,
      }
    : null;

  // The selection's summary sits beside the control that made it: under the
  // trace for a drag, above the splits table for a split row, so a keyboard
  // or phone user sees it without scrolling back up. Each spot is a polite
  // live region, so a screen reader hears the figures as they change.
  const rangeSummary = selected && (
    <RangeSummary
      stats={selected.stats}
      sport={sport}
      onClear={clearSelection}
    />
  );

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
          averages={averages}
          durationS={computed.stats.elapsedS}
          layout={layout}
          hrBaseline={hrBaseline}
          selection={selected?.area ?? null}
          onSelectRange={onSelectRange}
        />
        <div aria-live="polite" data-live="trace">
          {selected?.from === 'trace' && rangeSummary}
        </div>
        <SectionHeader>{t`Time in zone`}</SectionHeader>
        <ZoneBar result={zoneResult} anchor={anchor} hasPower={has.power} />
        {splitView?.splits.length > 0 && (
          <>
            <SectionHeader>{t`Splits`}</SectionHeader>
            <div aria-live="polite" data-live="splits">
              {selected?.from === 'split' && rangeSummary}
            </div>
            <SplitsTable
              splits={splitView.splits}
              sport={sport}
              mode={splitView.mode}
              splitM={splitView.splitM}
              splitOptions={sport === 'erg' ? ROWING_SPLIT_OPTIONS : null}
              onSplitM={sport === 'erg' ? onSplitM : null}
              selectedIndex={selectedSplit ? live.index : null}
              onSelect={onSelectSplit}
            />
          </>
        )}
        {analysis && (
          <div style={{ marginTop: SPACE.xl }}>
            <MoreDetail
              peaks={analysis.peaks}
              variability={analysis.variability}
              drift={analysis.drift}
              needs={analysis.needs}
            />
          </div>
        )}
      </>
    );
  } else {
    trace = (
      <SessionState
        kind={seriesState.state === 'ready' ? 'none' : seriesState.state}
        sessionId={sessionId}
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
        rowSource={session.source ?? null}
        href={series?.info.href ?? null}
        ownSummary={series?.info.ownSummary ?? null}
        measured={measured}
        derived={derived}
      />
    </>
  );
}
