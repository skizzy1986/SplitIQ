# SplitIQ — repo briefing

> Loads into every session and every subagent. It holds only what anyone working in
> this repo needs: the map, the commands and the code rules. `VISION.md` says what the
> app is for and wins where docs disagree.

> **Scott's sessions (local, cloud or phone): before any other work, invoke the
> `anthropic-skills:splitiq` skill.** It carries the doctrine this repo no longer
> holds: Supabase write rules, the load model, the shipping workflow, CI facts and the
> factory pipeline (`/anthropic-skills:splitiq-orchestrate` and friends). It is a
> claude.ai account skill, so it loads the same everywhere; its source is private.
>
> **Working for someone other than Scott?** That skill will not be there. An invited
> collaborator (read-only access, own clone) uses the **`/collaborate`** skill
> (`.claude/skills/collaborate/SKILL.md`). Never push to `skizzy1986/SplitIQ`.
> Onboarding starts at `docs/onboarding/START_HERE.md`.

## What SplitIQ is

A training app where the movements explain themselves: a 3D anatomical runtime
(`web/src/anatomy/`; first product `/squat`, public, no auth) wrapped around a training
log with an honest load model. Plans come from a generic deterministic planner; every
surface reads at a simple or an expert depth (`VISION.md`). User data is keyed on
`user_id` under owner-only RLS from the verified JWT. **No AI coach and no personal
prescription engine.** Stack: React 19 + Vite SPA under `web/` (Capacitor layout),
Recharts, Lingui, Supabase, Vercel, Vitest + RTL.

## Repo map

- `web/src/` — the app. Layers below; `squat/` (public `/squat` tool, web only, not in
  the APK), `anatomy/` (movement-neutral 3D runtime), `i18n/` + `locales/` (Lingui),
  `App.jsx` (shell/router — targeted edits only), `RouteRoot.jsx` (`/squat` →
  `SquatApp`, else `AuthGate`, both lazy), `main.jsx` (bootstrap).
- `/squat` must never import `supabaseClient.js` (`RouteRoot.test.jsx` pins it). Only
  `anatomy/scene/` imports three.js, loaded lazily (ESLint enforces).
- `web/.design-sync/` design surface (`DESIGN.md` first, before anything visual) ·
  `supabase/functions/` Edge Functions (`ls` them) · `supabase/migrations/` SQL +
  `manifest.json` · `docs/` squat, i18n, onboarding, environments · `pipeline/` the
  squat-anatomy data pipeline · `.github/workflows/` (derive the CI check set from
  here, never memorise it). Tracking is GitHub Issues.
- `.claude/` — `settings.json` (permissions allow/ask + hooks), `hooks/` (mechanical
  guardrails, smoke-tested in CI), `skills/collaborate/`.
- Env vars: `web/.env.example`. Cloud sessions: `docs/CLOUD_ENVIRONMENT.md`.

## Commands (in `web/`)

`npm run dev | build | preview` (dev → http://localhost:5173) · `npm test`
(`npx vitest run --coverage` for the report) · `npm run lint` · `npm run format |
format:check` · `npm run build && npm run size` (bundle budgets — re-measure, never
quote a figure) · `npm run check:zones | check:colours | check:design-sync |
check:migrations | check:no-llm | check:names | check:hooks`.

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
  are split one extraction at a time, never a big-bang rewrite.
- **Never read Strava data**: query `public.sessions_no_strava`, never the `sessions`
  base table, a `strava_*` table or `backup_snapshots`. A hook blocks it; the hook is a
  guardrail, not the reason.
- Never hardcode credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

### Context7

Library docs come from the Context7 MCP connector, never from memory, and before
WebSearch: `resolve-library-id` (`libraryName`, `query`) → `query-docs` (`libraryId`,
`query`). This binds on every library in the stack. Fall back to WebSearch only when
it returns nothing, or for tooling it does not index. **Name the source for every
library claim.** SplitIQ-ops `scripts/check-context7.mjs` guards this rule.

## Shipping

GitHub Issue → branch → PR → CI → `main`. Branch `<type>/<issue>-<slug>`; PR title
`<type>(<scope>): <change> (#<issue>)`, CI-enforced. Rebase, never merge. `main` blocks
direct pushes. Before pushing: `npm run build`, `npm run lint`, `npm run format:check`;
CI runs the full suite and is the gate.
