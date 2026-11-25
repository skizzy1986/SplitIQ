# Coordination

How Claude Code, Scott and the Grok bots stay out of each other's way. Read this
before starting work. The official decision log is the private ops repo's
`docs/ROADMAP.md` (D30, D31). `VISION.md` still wins where docs disagree;
see the VISION.md rule below.

Last updated: 25 November 2026, 11:45 Perth (UTC+8). Re-query GitHub
before treating the status section as live.

## Roadmap order (D31)

Scott confirmed this order on 25 November 2026 at 10:48 Perth:

- **Now:** the PM5 live session loop (live erg).
- Claude Code continues [#755](https://github.com/skizzy1986/SplitIQ/issues/755)
  (pipeline R20, slice 2). It does not overlap live-erg or PM5 files.
- Hold [#756](https://github.com/skizzy1986/SplitIQ/issues/756) until the bundle
  headroom work ([#776](https://github.com/skizzy1986/SplitIQ/issues/776)) lands.
  #756 edits the bundle gate and `RouteRoot.jsx`.
- Hold [#757](https://github.com/skizzy1986/SplitIQ/issues/757)–[#761](https://github.com/skizzy1986/SplitIQ/issues/761)
  and the squat H1 product work until **#747a PM5 interval send passes a real
  erg session** (the send slice of [#747](https://github.com/skizzy1986/SplitIQ/issues/747);
  Scott, 25 Nov 2026 11:23 Perth, confirmed at 11:37). Held, not dropped.
- `/row` is the second flagship movement after the live loop, per
  [#753](https://github.com/skizzy1986/SplitIQ/issues/753) (D30, which supersedes
  D2 and D5). Epics [#646](https://github.com/skizzy1986/SplitIQ/issues/646)
  (live erg and session pages) and
  [#719](https://github.com/skizzy1986/SplitIQ/issues/719) (multi-account
  production) are tracked on the ops roadmap; D31 does not rank #719 against the
  live loop.

## Who owns what

| Owner | Owns | Leaves alone |
|---|---|---|
| Claude Code | Pipeline slices [#755](https://github.com/skizzy1986/SplitIQ/issues/755)–[#761](https://github.com/skizzy1986/SplitIQ/issues/761); seat sensor [#731](https://github.com/skizzy1986/SplitIQ/issues/731)–[#738](https://github.com/skizzy1986/SplitIQ/issues/738) | Live erg, home, v10 design, and bundle headroom |
| Grok bots (Orchestrator files the PRs; Live Session, Sound, Data & Modelling, Release, Product) | Live erg, home and v10 design, bundle headroom. Product owns input on `VISION.md` | `pipeline/` (including the squat goldens and `pipeline/squat-anatomy/row/`), `hardware/seat-sensor/` |
| Scott only | Strava issues #632, #639, #644, #660–#666, #668, #669, #673 | — |

Do not rewrite Claude's issues. Do not start a second branch for work Claude already
owns. Do not read Strava data; query `public.sessions_no_strava`.

## VISION.md

`VISION.md` underpins Claude Code's anatomy and movement model work, and
still wins where docs disagree. SplitIQ Product (the Grok product lead)
owns input on it: proposed changes go through Product and need Scott's
yes. Claude should flag any `VISION.md` assumptions it relies on, or
needs changed, as a comment on the relevant issue. Do not edit
`VISION.md` outside that path.

## Handoff rules

- Rail: issue → branch `<type>/<issue>-<slug>` → PR
  `<type>(<scope>): <change> (#<issue>)` → CI → squash-merge only on Scott's
  explicit yes. Nobody merges without that yes.
- Bundle budgets are raised per PR, only with Scott's OK in the PR body (#504).
- One open PR at a time may touch the PM5 lane:
  `web/src/services/pm5Bluetooth.js`, `web/src/hooks/usePM5.js`,
  `web/src/views/ErgLiveView.jsx`. One pipeline-core PR at a time. Do not wipe
  `pipeline/squat-anatomy/row/` (the #762 spike lives there).
- Locale files are regenerated, not merged by hand (`npm run i18n:review`).
- Before touching a shared file, check open PRs. Shared files include:
  - `web/src/RouteRoot.jsx`
  - `web/scripts/check-bundle-size.mjs`
  - `web/vite.config.js`
  - `web/src/live-erg/liveErgFlag.js`
  - the PM5 BLE files above
  - `web/src/locales/**` and `docs/i18n/REVIEW-es-CO.md`

## How to flag a clash

Leave a comment on the relevant issue, or add a short note under Current status
in this file and open a PR. Do not silently edit `main`.

## Current status

As of 25 November 2026, 11:45 Perth (UTC+8), queried with `gh`.

- Main is `8a70030` after [#777](https://github.com/skizzy1986/SplitIQ/pull/777)
  (build number on the loading screen, merged 11:23 Perth). That tip also
  includes [#779](https://github.com/skizzy1986/SplitIQ/pull/779) (Supabase cut),
  [#781](https://github.com/skizzy1986/SplitIQ/pull/781) (this coordination file)
  and [#740](https://github.com/skizzy1986/SplitIQ/pull/740) (pace flicker fix).
  Testing APK 1.3.0+1266 (asset updated 11:25 Perth) includes those. The #740
  gym check is still open: row 2+ minutes and confirm pace, stroke rate and
  watts hold.
- Official dashboard size on main `8a70030` (the #777 CI report, against a #779
  baseline): TOTAL **407.4 / 433 KB**, about **25.6 KB spare**. ENTRY on the
  #779 cut was 179.3 / 208 KB. Re-measure with `npm run build && npm run size`
  before quoting a new figure. Raises still go through #504, per PR, with
  Scott's OK in the PR body.
- [#775](https://github.com/skizzy1986/SplitIQ/pull/775) (plan a workout before
  connecting the PM5, #774): open on `feat/774-plan-before-connect`, head
  `cbcba15`. It is being reworked to fold the PM5 connect step into the planner,
  so it should not merge until that lands.
- [#778](https://github.com/skizzy1986/SplitIQ/pull/778) (draft findings for
  #776) is still open. The #779 cut from that spike is already on main.
- [#730](https://github.com/skizzy1986/SplitIQ/pull/730) (stroke ratio and drive
  length, #729): draft, dirty against main when last checked, and needs a
  rebase, a re-measure against the new spare, and a real-erg check. Touches
  the PM5 lane.
- #755 is in progress in a Claude session. There is no public branch or PR yet;
  do not start a second one.
- Seat-sensor work is on draft [#738](https://github.com/skizzy1986/SplitIQ/pull/738)
  (`claude/project-thread-4vcvgb`).
- Do not merge [#703](https://github.com/skizzy1986/SplitIQ/pull/703),
  [#712](https://github.com/skizzy1986/SplitIQ/pull/712) or
  [#670](https://github.com/skizzy1986/SplitIQ/pull/670).
