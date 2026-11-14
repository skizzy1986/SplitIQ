---
name: training-science
description: >
  The load model the app computes — session load, CTL/ATL/TSB, readiness and
  CP-derived zones — and where each lives in the code. Read when working on
  analytics, readiness scoring, load charts or zone display. Generic to any user:
  calibration comes from the per-user `anchors` table, never from this file.
---

> Cite the functions below; do not copy their coefficients into prose. A number
> written here is a snapshot that will not recompute when the code changes.

## Session load — `sessionLoad` (`web/src/utils/trainingLoad.js:38`)

Classic TSS units: an hour at threshold reads 100, and so does an hour at sRPE 10.
sRPE wins whenever it exists. Without it (e.g. Strava-backfilled sessions), load
falls back to power: intensity factor (avg watts / threshold), squared, × 100 — the
standard TSS formula. Rowing watts are measured against `rowing_cp`, bike watts against
`bike_ftp`; strength and mobility have no power model. A missing anchor degrades to
zero load rather than a hardcoded default. Every downstream threshold (the TSB bands,
readiness's TSB deduction) assumes this unit — do not rescale one side alone.

## CTL / ATL / TSB — `calcTrainingLoad` (`web/src/utils/trainingLoad.js:56`)

Exponential moving averages of daily load: **CTL** (fitness) with a 42-day time
constant, **ATL** (fatigue) with 7. The decay factor is `Math.exp(-1 / days)` —
not `1 - 1/days`. **TSB** = CTL − ATL, the "form" number: positive is fresh, negative
is fatigued. Only completed sessions count (`useTSSHistory` filters on
`COMPLETED_STATUSES`); a planned session never does.

## Readiness — `computeReadiness` (`web/src/utils/recoveryAnalytics.js:50`)

The single readiness definition for the app. A 100 ceiling with deductions for RHR
above baseline, HRV below baseline, sleep debt against the target, and deep TSB
fatigue (`tsb` is optional). Baselines come from `computePersonalBaselines` once
enough personal data exists, population fallbacks until then (both in the same file).
Without an RHR there is nothing to score: the result is `NO DATA`, never a fabricated
verdict. Otherwise the status is READY / CAUTION / FATIGUED, and `partial` flags a
score made without HRV or sleep. Read the file for the coefficients and cut-offs.

## Zones — `derivePaceZones(cp)` (`web/src/constants/trainingConfig.js:69`)

Power and pace bands derived from Critical Power as fractions of CP. Callers pass the
live `anchors.rowing_cp`; there is deliberately no static zone export, because a second
set keyed off a constant would silently diverge. Any band published in a tracked `.md`
must recompute against this function (`npm run check:zones`), so prefer not to publish
one.

## Erg metrics (generic)

| Metric | Description |
|--------|-------------|
| Split | Pace per 500m — lower is faster |
| Watts | Power output — higher is better |
| spm | Strokes per minute — rate |
| DF | Drag factor — erg resistance; keep it consistent session to session for valid comparisons |
| 2k time | 2000m time trial — the standard rowing benchmark |
