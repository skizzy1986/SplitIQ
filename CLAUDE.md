# SplitIQ — repo briefing (erg-dashboard)

> Loads into every session and every subagent, so it stays under 200 lines: detail lives
> in the files indexed below, one fact in one place. `VISION.md` says what the app is for
> and wins where docs disagree; this file says how the repo works.

> **Working for someone other than Scott?** For an invited collaborator (read-only
> access, own clone) use the **`/collaborate`** skill (`.claude/skills/collaborate/SKILL.md`);
> its rules override the parts of this file written for Scott's own sessions (Supabase
> writes, worktrees, the full pipeline). Never push to `skizzy1986/erg-dashboard`.
> Onboarding starts at `docs/onboarding/START_HERE.md`.

## What SplitIQ is

A training app where the movements explain themselves: a 3D anatomical runtime
(`web/src/anatomy/`; first product `/squat`, public, no auth) wrapped around a training
log with an honest load model. "Coach" means a person who reads what an athlete shares;
plans come from a generic deterministic planner; every surface reads at a simple or an
expert depth (`VISION.md`). User data is keyed on `user_id` under owner-only RLS from the
verified JWT. **No AI coach and no personal prescription engine.** Stack: React 19 + Vite
SPA under `web/` (Capacitor layout), Recharts, Lingui, Supabase, Vercel, Vitest + RTL.

## Where things live

| Topic | File |
|---|---|
| What it is for; the cull list | `VISION.md`, `docs/ROADMAP.md` |
| Issue → PR workflow, board, migrations procedure | `WORKFLOW.md` |
| The factory pipeline and its gates | `FACTORY.md`, `.claude/skills/orchestrate/SKILL.md` |
| Which agent for which job; the parked library | `.claude/AGENTS.md`, `.claude/agent-library/README.md` |
| Spawn preamble — prepend to every agent spawn | `.claude/skills/erg-context.md` |
| Visual design (read before anything visual) | `DESIGN.md` → `web/.design-sync/` |
| Folder layout, layer rules, large files | `.claude/skills/architecture.md` |
| Supabase queries, RLS, migrations | `.claude/skills/supabase-patterns.md`, `supabase/migrations/manifest.json` |
| Load model detail | `.claude/skills/training-science.md` |
| CI checks, required set, PR review facts | `.claude/skills/steward/SKILL.md` |
| Sentry, CSP, edge-function reporting, bundle budgets | `.claude/rules/observability.md` (loads on matching files) |
| Cloud sessions (setup, allowlist, connectors) | `docs/CLOUD_ENVIRONMENT.md` |
| Squat tool provenance and data; licences | `docs/squat/`, `pipeline/squat-anatomy/`, `NOTICE.md`, `LICENSE`, `PERMISSIONS.md` |
| Env vars | `web/.env.example` |

Skills: `/orchestrate` (alias `/feature`), `/refactor`, `/research`, `/daily`, `/audit`,
`/collaborate`; read `steward` before acting on CI results or PR review comments.

## Repo map

- `web/src/` — the app. Layers below; `squat/` (public `/squat` tool, web only, not in
  the APK), `anatomy/` (movement-neutral 3D runtime), `i18n/` + `locales/` (Lingui),
  `App.jsx` (shell/router — targeted edits only), `RouteRoot.jsx` (`/squat` →
  `SquatApp`, else `AuthGate`, both lazy), `main.jsx` (bootstrap).
- `/squat` must never import `supabaseClient.js` (`RouteRoot.test.jsx` pins it). Only
  `anatomy/scene/` imports three.js, loaded lazily (ESLint enforces).
- `web/.design-sync/` design surface · `supabase/functions/` Edge Functions (`ls` them)
  · `supabase/migrations/` SQL + `manifest.json` · `docs/` roadmap, squat, i18n,
  onboarding · `coach/` historical (`work-orders/` deprecated; tracking is GitHub Issues)
  · `.github/workflows/` (derive the CI check set from here, never memorise it).
- `.claude/` — `agents/` (loadable), `agent-library/` (parked, not loaded), `skills/`,
  `rules/`, `settings.json` (permissions allow/ask + hooks).

## Commands (in `web/`)

`npm run dev | build | preview` (dev → http://localhost:5173) · `npm test`
(`npx vitest run --coverage` for the report) · `npm run lint` · `npm run format |
format:check` · `npm run build && npm run size` (bundle budgets — re-measure, never
quote a figure) · `npm run check:zones | check:context7 | check:colours |
check:design-sync | check:migrations | check:no-llm | check:names | check:hooks`.

## Writing code

- Layers: `constants/` plain data, no imports, no React · `utils/` pure functions,
  fully testable · `hooks/` React hooks, Supabase calls live here (React Query) ·
  `components/` reusable JSX, props in, no direct Supabase calls · `views/` tab-level
  JSX (`views/mobile/` for mobile) · `services/` device integrations (PM5 Bluetooth).
- Plain JavaScript + JSX — **no TypeScript**. Inline styles only (no CSS modules, no
  Tailwind). **Read every colour from `THEME` (`web/src/constants/theme.js`) — never type
  a raw hex**; `DESIGN.md` first, `npm run check:colours` pins the allowlist.
- Comment only a non-obvious WHY. No abstractions beyond the task. One `formatDate`
  helper — no date-formatting variants. PascalCase components, camelCase utils/hooks;
  tests co-located in `__tests__/` or `*.test.js`, shipped in the same PR.
- Errors: report handled errors through `captureError()` (`web/src/utils/sentry.js`) and
  `captureFunctionError()` (`supabase/functions/_shared/sentry.ts`), never the SDK
  directly. react-query failures are already captured (`utils/queryErrorHandlers.js`);
  supabase-js calls outside react-query capture their own. **Never swallow an
  operational error**: a bare `catch {}` only for expected non-events, with a comment.
  Any new outbound host means updating `connect-src` in `web/vercel.json`. Large files
  are split one extraction at a time via `/refactor`, never a big-bang rewrite.

## Load model

CTL = 42-day exponential average of training load (fitness); ATL = 7-day (fatigue); TSB
= CTL − ATL (form); sRPE = session effort, 1–10 (`sessionLoad`, `calcTrainingLoad`,
`computeReadiness`). CP is per-user calibration from `anchors` (`rowing_cp`); zones come
from `derivePaceZones(cp)`; never hardcode either (`.claude/skills/training-science.md`).

## Supabase data — honour on every write

Project `swdrueaserjzhuxnzmeu` (ap-northeast-1). Tables via MCP `list_tables`, migrations
via `supabase/migrations/manifest.json`; never quote a count. **An MCP `execute_sql` or
`apply_migration` call loads no rule file, so every write convention is here.**

- **Tables with conventions:** `sessions`, `vitals`, `strength_workouts`, `strength_sets`,
  `templates`, `template_exercises`, `workout_assignments`, `exercises` (text ids),
  `exercise_media`, `exercise_prefs`, `coach_log`, `anchors`, `backup_snapshots`,
  `bp_readings`, `lab_results`, `injuries` (`strava_*`: migration 012, not applied).
- **`sessions`:** `date` is **text `M/D/YY`, unpadded** — the write column. `date_iso` is
  a **generated `date`, read-only**, derived by `session_date_to_iso()`, indexed, and the
  only correct thing to `order by`; an insert that names it is rejected, and a `date`
  that will not parse is rejected by the `sessions_date_parseable` check. Other columns:
  `type`, `label`, `duration`, `srpe`, `prs`, `exercises` (jsonb), `coach_note`,
  `status`, `coach_flag`, `avg_watts`, `avg_hr`, `distance_m`, `source` (default
  `portal`; `coach` on historical rows), `user_id`. No watt-target columns — targets
  live in `label` + `coach_note`. Status: `"actual"`, `"completed"`, `"logged"` (all
  completed; `"logged"` from the live PM5 save path, the others from imported history),
  `"planned"` (a prescription, never counted as done) or `"cancelled"`.
- **`vitals`:** `date` is a real `date`; upsert on `(user_id, date)`. RHR/HRV/sleep/
  bodyweight auto-fill via the `vitals-import` cron (7-arg `upsert_vital`); the Google-Health
  activity columns (`steps_count`, `distance_m`, `active_minutes`, `calories_kcal`) via
  `vitals-sync` (the live-only 11-arg overload, #454).
  `readiness` + `soreness` are the only manual inputs (morning check-in).
- **Strength sessions:** a completed session is a `strength_workouts` container with
  `status='completed'`, linked to the calendar via `session_id → sessions.id` and to
  the template via `template_id`; the breakdown goes in `notes`, `prs` on the `sessions`
  row. Historical rows written through the connector carry `origin='coach'`. Populate
  `strength_sets` only with real per-set data (in-app logging); never fabricate reps.
- **Context store** — native `date`/`timestamptz`, owner-only RLS. `coach_log` is an
  append-only diary + decision record: `date`, `entry_type` (`diary` | `decision` |
  `observation`), `body`, `author` (`scott`; `coach` on historical rows), `tags`
  (text[]), `supersedes` (nullable self-FK), `created_at`. **Never edit a row in place**;
  to reverse a decision insert a new row pointing at the one it overrides.
  `anchors` holds current calibration and phase state: `key`, `value` (text), `unit`,
  `status` (`provisional` | `unvalidated` | `confirmed`), `source`, `valid_from`,
  `superseded_at` (nullable), `note`. **One live row per key** (partial unique index on
  `(user_id, key)` where that column is null); to update, stamp the old row `now()` and
  insert the new one. Live keys: `rowing_cp`, `bike_ftp`, `current_phase`,
  `current_block`, `drag_factor`, and `doctrine_sha`, which pins the doctrine commit (this file +
  `.claude/skills/training-science.md`; prose stays in git) and maintains itself:
  `doctrine-sha-guard.yml` opens an issue on drift; the **`Supabase Doctrine_SHA anchor
  update`** Routine supersedes it nightly at 01:00 UTC (only that key, no-op when it
  matches, stops on ambiguity) and closes the issue. Never hand-supersede it unless the
  Routine is disabled.
- **Lanes:** Code owns the schema (tables, structural seed, migrations). Scott owns and
  authorises row content — every diary entry and anchor (`rowing_cp`, `bike_ftp`,
  `current_phase`, `current_block`, `drag_factor`), because each encodes a decision.
  The self-maintaining anchor above is the one automated exception.
- **Gotchas:**
  - Supply the `user_id` UUID explicitly on inserts — the column default `auth.uid()`
    does not resolve through the MCP connector. RLS is always on; never bypass it.
  - Order `sessions` by `date_iso`, never the text `date` (lexical order returns the
    wrong rows under a `LIMIT`); descending needs `NULLS LAST` (`nullsFirst: false`).
    Never `to_date(...)`: it is STABLE, so it cannot be indexed or generated.
  - `UNIQUE(date, label)` on `sessions` — temp-suffix labels before bulk shuffles
    (`set label = label || '~tmp'`).
  - Vitals upsert: `on conflict (user_id, date) do update`. DDL via a named
    `apply_migration`, never raw `execute_sql`; migrations are additive with a rollback
    file (`supabase-patterns.md`).
  - Read back every write. Scott authorises consequential, destructive and schema
    changes; review structure before material writes. **Never delete Supabase rows
    without confirming with Scott first.**

## MCP servers

### Context7

Current, version-specific library docs, connected in every session. Two steps, in order:
`resolve-library-id` (`libraryName`, `query`) → `query-docs` (`libraryId`, `query`). Use
it before WebSearch for every library in the stack; fall back to WebSearch only when it
returns nothing or for unindexed tooling. **Name the source for every library claim.** The
canonical rule is in `.claude/skills/erg-context.md`; `npm run check:context7` guards it.

### Sentry

Org `splitiq-29`, **EU-region**: every MCP call needs `regionUrl: "https://de.sentry.io"`.
Projects `erg-dashboard` (app) and `erg-dashboard-functions` (edge functions).

## Shipping a change

**GitHub Issue → branch → PR → CI → `main`** (`WORKFLOW.md`); status: "Split IQ" board. An epic's slices are its sub-issues.

- Names carry the issue number: branch `<type>/<issue>-<slug>` off a freshly fetched
  `origin/main`; PR title `<type>(<scope>): <change> (#<issue>)`, CI-enforced; issue titles
  plain, no prefix. Rebase, never merge; `--force-with-lease` only. `main` blocks direct pushes and stale branches.
- Before pushing: `npm run build`, `npm run lint`, `npm run format:check`; `.husky/pre-push`
  runs the tests the diff reaches (`npx vitest run --changed origin/main --passWithNoTests`).
  CI runs the full suite and is the gate. Never `--no-verify` without a reason. Coverage
  thresholds live only in `web/vite.config.js`, only go up. Required checks: per `steward`, never a list.
- Never hardcode credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Never edit
  agent files in `.claude/agents/` or `.claude/agent-library/` (erg behaviour is applied
  at spawn time). CI, Vercel and edge-function runs post to `#build` in Slack.

### Concurrent local sessions: one worktree each

Local sessions in one directory share one working tree and `HEAD`, so a `git checkout`
in one yanks files from under another (three sessions collided on 2026-08-25). Call
`EnterWorktree` before the first edit; it cuts a branch from fresh `origin/main`
(`worktree.baseRef: "fresh"` in `.claude/settings.json`). For an open PR,
`git worktree add <path> <branch>` then `EnterWorktree` with `path` (one branch, one
worktree). Commit or stash before switching; run `npm install` in `web/` first; worktrees
live in `.claude/worktrees/` (gitignored). A cloud session (own VM and clone) or a Kepler
session (worktree and branch pre-made; install deps first) skips this, stays on its branch.
