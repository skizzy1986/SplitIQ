# SplitIQ

A training app where the movements explain themselves: a 3D anatomical model shows
what a lift does, wrapped around a training log with an honest load model. See
[`VISION.md`](VISION.md).

[![CI — Web](https://github.com/skizzy1986/SplitIQ/actions/workflows/ci-web.yml/badge.svg)](https://github.com/skizzy1986/SplitIQ/actions/workflows/ci-web.yml)
[![CI — Android](https://github.com/skizzy1986/SplitIQ/actions/workflows/ci-android.yml/badge.svg)](https://github.com/skizzy1986/SplitIQ/actions/workflows/ci-android.yml)

**v1.3.0** · React 19 + Supabase + Capacitor Android · Deployed on Vercel

> **New collaborator?** Start at [`docs/onboarding/START_HERE.md`](docs/onboarding/START_HERE.md)
> (no GitHub experience needed). From there, run the public squat tool with no secrets,
> learn how it's built with Claude Code's `/collaborate` mode, and share ideas in
> [Discussions](https://github.com/skizzy1986/SplitIQ/discussions/categories/ideas).

---

## What This Is

For anyone who lifts or rows and wants to understand their training, not just record
it. The public squat tool (`/squat`, no sign-in) models which muscles work through the
whole range. The training log covers erg, strength, bike and mobility sessions, live PM5
Bluetooth data, HRV-aware readiness and training load (TSS/CTL/ATL/TSB) computed from
real session data. No AI coach: every recommendation is deterministic and testable.
A hobby built to a public-quality standard.

---

## Features

| View | What it does |
|------|-------------|
| **Overview** | TSS/CTL/ATL/TSB training load chart, weekly load summary |
| **Calendar** | Month view of planned vs completed sessions |
| **Plan** | Upcoming planned sessions |
| **Live** | Real-time Bluetooth connection to a Concept2 PM5 (watts, pace, HR) |
| **Erg** | Erg analytics: pace trend against CP-derived zones |
| **Strength** | e1RM trends per lift |
| **Logger** | Live strength-set logging with rest timers and a static hold timer |
| **Mobility** | Mobility session tracking |
| **Recovery** | HRV/RHR/sleep and the readiness score from Google Health data |
| **Log** | Full session history |
| **Settings** | Language, Strava connection |
| **`/squat`** | Public 3D squat tool — no sign-in |

**Mobile:** Android APK (Capacitor 8) with dedicated mobile views organised as Today,
Train, Progress and Body. PWA installable on iOS/web.

**Offline:** Service worker queues sessions written offline; syncs on reconnect.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite |
| State / data fetching | TanStack React Query v5 |
| Charts | Recharts |
| Backend | Supabase (Postgres, Auth, Edge Functions on Deno) |
| Mobile | Capacitor 8 → Android APK; PWA for iOS/web |
| Hosting | Vercel (auto-deploy on push) |
| Bluetooth | `@capgo/capacitor-bluetooth-low-energy` → Concept2 PM5 |
| i18n | Lingui (English, Spanish es-CO) |
| Testing | Vitest + React Testing Library |
| CI/CD | GitHub Actions |
| Pre-commit | Husky + lint-staged |

---

## Architecture

```
Browser / Android APK
  └── React 19 SPA (web/src/)
        ├── views/          — one component per tab (desktop + mobile/)
        ├── hooks/          — data fetching (React Query + Supabase), derived state
        ├── components/     — shared UI (charts, forms, log entries)
        ├── utils/          — pure functions: load model, HRV analytics, formatting
        ├── constants/      — training config, UI config
        ├── squat/          — public /squat tool
        └── anatomy/        — 3D model runtime (three.js, lazy)
              │
              ▼
        Supabase (Postgres + Auth, owner-only RLS)
        ├── sessions        — all workouts (erg, strength, cycling, rest, planned)
        ├── vitals          — daily RHR / HRV / sleep / bodyweight
        └── …               — list the rest with the Supabase MCP `list_tables`
              │
              ▼
        Supabase Edge Functions (Deno) — `ls supabase/functions`
        (vitals import from Google Health, Strava OAuth and sync)
```

The former monolith has been decomposed into the modular structure above using a
strangler-fig refactor — one safe extraction at a time, app stays functional
throughout — and the entry point is now `web/src/App.jsx` (renamed in PR #145,
closing #52). `StrengthLogger.jsx` is still to be split (#79).

---

## Development Setup

### Prerequisites

- Node.js 22+
- A Supabase project (free tier works)

### Environment variables

Create `web/.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

See `web/.env.example` for the full list, including the optional Sentry vars.

### Error monitoring

Runtime errors go to Sentry (org `splitiq-29`, **EU region**, project
`erg-dashboard`). Locally it is off by default: `initSentry()` no-ops unless
`VITE_SENTRY_DSN` is set, so dev and CI stay silent.

Production configuration lives in the Vercel dashboard, not the repo:
`VITE_SENTRY_DSN` at runtime, plus `SENTRY_ORG` / `SENTRY_PROJECT` /
`SENTRY_URL=https://de.sentry.io` / `SENTRY_AUTH_TOKEN` at build time to upload
source maps. Because the org is EU-region, the ingest host
(`*.ingest.de.sentry.io`) must stay in the `connect-src` CSP directive in
`web/vercel.json` — without it the browser blocks every event.

### Local dev

```bash
cd web
npm install
npm run dev          # → http://localhost:5173
```

### Key commands

```bash
npm run dev          # Dev server with HMR
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
npm test             # Vitest test suite
npm run lint         # ESLint
npm run format       # Prettier (auto-fix)
npm run format:check # Prettier check (no writes — used in CI)
npx vitest run --coverage  # Tests + coverage report
```

---

## Project Structure

```
SplitIQ/
├── web/
│   ├── src/
│   │   ├── constants/        training config, exercise library, UI config
│   │   ├── hooks/            React Query hooks + Supabase data layer
│   │   ├── utils/            TSS calc, HRV analytics, scheduling, formatting
│   │   ├── components/       shared UI components
│   │   ├── views/            desktop views (ErgLiveView, RecoveryView, …)
│   │   │   └── mobile/       mobile-specific views (MobileApp, MobileRecovery, …)
│   │   ├── services/         pm5Bluetooth.js (BLE abstraction)
│   │   ├── squat/            public /squat tool
│   │   ├── anatomy/          3D model runtime
│   │   ├── App.jsx           shell/router (formerly erg-dashboard.jsx)
│   │   └── main.jsx          auth gate (Supabase email/password)
│   ├── android/              Capacitor Android project
│   ├── capacitor.config.json
│   └── vite.config.js        includes Vitest config + PWA manifest
├── supabase/
│   ├── functions/            Edge Functions (Deno)
│   └── migrations/           SQL migration files
└── .github/
    └── workflows/
        ├── ci-web.yml        lint → test → build
        └── ci-android.yml    build web → sync Capacitor → build APK
```

---

## CI/CD

### Web (`ci-web.yml`) — runs on every PR, and on push to `main`

| Job | What it checks |
|-----|---------------|
| **Lint & Format** | ESLint + Prettier + `npm audit --audit-level=high` |
| **Test & Coverage** | All Vitest tests pass; posts coverage summary as a PR comment |
| **Build** | `npm run build` exits 0 (runs only after Test passes) |

### Android (`ci-android.yml`) — runs on every PR, and on push to `main`

Builds web assets, syncs via `npx cap sync android`, assembles a debug APK
with Gradle. The APK is uploaded as a build artifact (retained 14 days).

### Other automation

- **Branch protection on `main`:** direct pushes blocked; all changes go
  through PRs with passing CI.
- **Vercel:** auto-deploys on push to main; preview URLs on every PR.
- **Dependabot:** weekly grouped PRs for npm and GitHub Actions updates.
- **Pre-commit (Husky + lint-staged):** ESLint + Prettier run automatically on
  staged `.js`/`.jsx` files before every local commit.
- **Design system:** the visual direction, the light redesign spec and the
  synced claude.ai/design component library live under `web/.design-sync/`.
  Start at [`DESIGN.md`](DESIGN.md); `npm run check:design-sync` guards it in CI.

---

## Development Workflow

All feature work flows through a **software factory** — a chain of Claude
agents from the Agency library, orchestrated by the `/orchestrate` skill, with
three human approval gates.

```
/feature <description>   →  full pipeline (alias for /orchestrate)
/refactor <module>       →  safe strangler-fig extraction
/research <topic>        →  research only, no code
```

**Pipeline:**

```
research  →  story  →  [GATE 1]  →  spec  →  [GATE 2]
          →  build + tests  →  verify  →  review + validate
          →  [GATE 3]  →  PR  →  CI  →  merge
```

The Agency agents the factory uses live in `.claude/agents/` (the rest of the
library is parked in `.claude/agent-library/`); the pipeline itself is
defined in `.claude/skills/orchestrate/SKILL.md` (see `FACTORY.md` for the
model). It never advances past a gate without explicit approval.

---

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md). Still open from the original list:

- **Signed Android release APK** — for Play Store or direct distribution

---

## Background

Built by Scott with Claude. It started as a static React artifact for one rower and
grew into a full-stack app; it is now SplitIQ, a training app for anyone, built as a
hobby to a public-quality standard. The architecture decisions (Supabase, Capacitor,
strangler-fig refactor) reflect real constraints: a single developer, a phone-first
training environment, and owning the data rather than renting it.
