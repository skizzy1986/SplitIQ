# Coordination

How Claude Code, Scott and the Grok bots stay out of each other's way. Read this
before starting work. The official decision log is the private ops repo's
`docs/ROADMAP.md` (D30, D31, D32). `VISION.md` still wins where docs disagree;
see the VISION.md rule below.

Last updated: 25 November 2026, 23:34 Perth (UTC+8). Re-query GitHub
before treating the status section as live.

## Roadmap order (D31)

Scott confirmed this order on 25 November 2026 at 10:48 Perth:

- **Now:** the PM5 live session loop (live erg).
- Claude Code's [#755](https://github.com/skizzy1986/SplitIQ/issues/755) (pipeline
  R20, slice 2) merged on 25 November as `5def051`
  ([#803](https://github.com/skizzy1986/SplitIQ/pull/803)).
- [#756](https://github.com/skizzy1986/SplitIQ/issues/756) (build, route and
  bundle budgets, R15) merged on 25 November as `ef08928`
  ([#814](https://github.com/skizzy1986/SplitIQ/pull/814)), once the #776 Supabase
  cut ([#779](https://github.com/skizzy1986/SplitIQ/pull/779)) had landed. Scott
  lifted the hold.
- Hold [#757](https://github.com/skizzy1986/SplitIQ/issues/757)–[#761](https://github.com/skizzy1986/SplitIQ/issues/761)
  and the squat H1 product work until the first gym-backed live slice is through.
  Held, not dropped.
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

## Backends (D32)

Recorded 25 November 2026, 12:32 Perth, in the private ops `docs/ROADMAP.md`
([ops #10](https://github.com/skizzy1986/SplitIQ-ops/pull/10), merged).

- **Production** is Scott's private database. Licensing gates such as R2 do
  not restrict his own use of it.
- **SplitIQ dev** is the public-facing database for invited testers, previews
  and development.
- Testers never get a production account. Do not copy personal rows from
  production into dev (schema and the repo exercise catalogue only).
- Do not point `android-latest` or the production website at dev. Testers get
  a separate URL and a separate app.
- Closed testing is tracked by
  [#788](https://github.com/skizzy1986/SplitIQ/issues/788) and runs alongside
  [#747](https://github.com/skizzy1986/SplitIQ/issues/747).

The PM5-lane rule below still applies: no tester slice may edit
`web/src/views/ErgLiveView.jsx` while
[#786](https://github.com/skizzy1986/SplitIQ/pull/786) or
[#730](https://github.com/skizzy1986/SplitIQ/pull/730) is open.

## Handoff rules

- Rail: issue → branch `<type>/<issue>-<slug>` → PR
  `<type>(<scope>): <change> (#<issue>)` → CI → squash-merge only on Scott's
  explicit yes. Nobody merges without that yes.
- Bundle budgets are raised per PR, only with Scott's OK in the PR body (#504).
  Since #756, the movement, shared 3D and data-file budgets sit in
  `web/scripts/movementAssets.mjs`, each beside its dated comment. The
  dashboard's stay in `web/scripts/check-bundle-size.mjs`.
- One open PR at a time may touch the PM5 lane:
  `web/src/services/pm5Bluetooth.js`, `web/src/hooks/usePM5.js`,
  `web/src/views/ErgLiveView.jsx`. One pipeline-core PR at a time. Do not wipe
  `pipeline/squat-anatomy/row/` (the #762 spike lives there).
- Locale files are regenerated, not merged by hand (`npm run i18n:review`).
- Before touching a shared file, check open PRs. Shared files include:
  - `web/src/RouteRoot.jsx`
  - `web/scripts/check-bundle-size.mjs`
  - `web/scripts/movementAssets.mjs`: the movement registry. It drives tool chunk
    naming, the Workbox ignores and caches, the movement budgets and the APK strip.
  - `web/vite.config.js`. Since #756 its `runtimeCaching` and `globIgnores` are
    built from the registry.
  - `web/vercel.json`. `vercelRewrites.test.js` holds its rewrites and headers
    equal to the registry.
  - `web/src/live-erg/liveErgFlag.js`
  - the PM5 BLE files above
  - `web/src/locales/**` and `docs/i18n/REVIEW-es-CO.md`

## How to flag a clash

Leave a comment on the relevant issue, or add a short note under Current status
in this file and open a PR. Do not silently edit `main`.

## Current status

As of 25 November 2026, 23:34 Perth (UTC+8), queried with `gh`. An item marked
"as of 11:09" was not re-checked.

- Main is `ef08928`, after [#814](https://github.com/skizzy1986/SplitIQ/pull/814)
  merged at 23:23 Perth. That was #756: one movement registry, `/row` as a
  `noindex` placeholder, and the squat byte-identical. The row's three data
  files are registered as pending until #760.
- Merged earlier on 25 November, all Perth times:
  - [#779](https://github.com/skizzy1986/SplitIQ/pull/779), the Supabase cut
    from #776, at 11:08;
  - [#777](https://github.com/skizzy1986/SplitIQ/pull/777), the build number on
    the splash, at 11:23;
  - [#775](https://github.com/skizzy1986/SplitIQ/pull/775), plan a workout before
    connecting the PM5, at 12:11;
  - [#803](https://github.com/skizzy1986/SplitIQ/pull/803), #755 pipeline core,
    at 13:25.
- As of 11:09: Testing APK 1.3.0+1254 includes the #740 pace flicker fix. Its gym
  check was still open then: row 2+ minutes and confirm pace, stroke rate and
  watts hold.
- [#786](https://github.com/skizzy1986/SplitIQ/pull/786) (voice cues, #785)
  overlaps #814 in `web/vite.config.js`, because `runtimeCaching` is now built
  from the registry. Whoever rebases keeps `...DATA_RUNTIME_ROUTES,
  TOOL_CODE_ROUTE` and adds the `cues-v1` entry; details are on
  [#785](https://github.com/skizzy1986/SplitIQ/issues/785). Regenerate
  `docs/i18n/REVIEW-es-CO.md` with `npm run i18n:review`; never merge it by hand.
- [#778](https://github.com/skizzy1986/SplitIQ/pull/778), the draft findings for
  #776, is still open, and so is #776 itself.
- [#730](https://github.com/skizzy1986/SplitIQ/pull/730) (stroke ratio and drive
  length, #729) is still a draft. As of 11:09 it was dirty against main and its
  Build check was failing. It needs a rebase, a re-measure and a real-erg check,
  and it touches the PM5 lane.
- Seat-sensor work is on draft [#738](https://github.com/skizzy1986/SplitIQ/pull/738)
  (`claude/project-thread-4vcvgb`).
- Do not merge [#703](https://github.com/skizzy1986/SplitIQ/pull/703),
  [#712](https://github.com/skizzy1986/SplitIQ/pull/712) or
  [#670](https://github.com/skizzy1986/SplitIQ/pull/670).
- Bundle figures: re-measure with `npm run build && npm run size` in CI's env (no
  `.env`, the placeholder `VITE_SENTRY_DSN`). #814's body holds the exact before
  and after against `5def051`. Do not quote figures here.
