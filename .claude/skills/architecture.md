---
name: architecture
description: >
  Folder layout, layer rules and the strangler-fig sequence for the web app.
  Read when asked where to put code, how to structure a new feature, or how to
  safely extract a module from App.jsx or another large file.
---

## Layout (directory level)

List a directory's files with `git ls-files web/src/<dir>`; this section names
directories and roles only, so it does not go stale with every file.

```
web/src/
  constants/      plain data, flat files (no imports, no React)
  utils/          pure functions, unit-tested in utils/__tests__/
  hooks/          React hooks; Supabase calls via React Query
  components/     reusable JSX, props in
    mobile/       mobile-only shared components (BottomTabBar)
  services/       device/native integrations (pm5Bluetooth.js)
  views/          desktop tabs, one file per tab, lazy-loaded from App.jsx
    mobile/       mobile tab views (MobileApp.jsx is the mobile shell)
  i18n/           Lingui runtime wiring (locale, provider, catalog registration)
  locales/        Lingui catalogs (boot catalog; views/ holds the views catalog)
  squat/          public squat tool at /squat (web only, no auth, not in the APK):
                  constants/, utils/, hooks/, components/, workers/ (gzip decode),
                  locales/, assets/ (extracted CC BY-SA anatomy data + LICENSE.md)
  anatomy/        movement-neutral 3D model runtime used by /squat:
                  utils/ (pure posing, colour and camera maths, fixture-tested
                  against the source page — docs/squat/SKINNING.md — plus the
                  generic manifest readers), constants/ (scene style), scene/
                  (the ONLY code that imports three.js; loaded lazily via
                  scene/loadScene.js — ESLint enforces)
  test/           shared test helpers
  App.jsx         desktop shell/router: nav, per-tab error boundary, view dispatch
  AuthGate.jsx    auth gate; lazy-loads the dashboard shells
  RouteRoot.jsx   picks the product: /squat -> squat/SquatApp, else AuthGate (both lazy)
  main.jsx        bootstrap (Sentry, react-query, theme vars) -> RouteRoot
  supabaseClient.js  Supabase init (never imported by /squat)
  StrengthLogger.jsx live strength-set logger (the Logger tab)
```

## Large files

Measure with `wc -l`; do not record counts here.

- `App.jsx` — the former `erg-dashboard.jsx` monolith, decomposed into the views above
  (#52, closed by PR #145). A shell now: targeted edits only.
- `StrengthLogger.jsx` — not yet extracted, untested (#79).
- `ProgramView.jsx` and `views/program/` (#77) were removed by the product-coherence
  slices (#499); there is no Program tab.

## Layer Rules

| Layer | Rule |
|---|---|
| constants/ | Plain JS only. No imports. No React. No functions — data only. |
| utils/ | Pure functions. No React hooks. No side effects. Fully unit-testable. |
| hooks/ | React hooks only. Supabase calls via React Query (useQuery/useMutation). |
| components/ | Reusable JSX. Receives props. No direct Supabase calls. |
| views/ | Tab-level JSX. Receives props from App.jsx. Orchestrates components. |
| App.jsx | useState, navigation, ErrorBoundary wrapper. No business logic. |

## Refactor sequence (follow this order strictly)

1. constants/ (extract all hardcoded arrays and objects first)
2. utils/ (pure functions — write tests immediately after extraction)
3. hooks/ (React hooks — mock Supabase in tests)
4. components/ (import back into monolith and confirm render)
5. views/ (extract one at a time — confirm prop threading each time)
