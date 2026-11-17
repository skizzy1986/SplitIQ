# Erg Context — canonical spawn preamble

> Prepend the FULL contents of this file to every pipeline subagent prompt.
> Agency-library agents are generic — this block is what makes them erg-aware.
> The invoking skill appends a stage addendum after it. One copy lives here;
> everything else points at this file instead of duplicating it.
>
> Root `CLAUDE.md` is already in your context: it carries the code style, layers,
> Supabase write rules, load model and shipping rules. If it is not, read it first.

## Project

SplitIQ — a training app where the movements explain themselves: a 3D anatomical
runtime around a training log with an honest load model. `VISION.md` wins where docs
disagree. Never reintroduce an AI coach or a personal prescription engine (#412).
Never read Strava data: query `public.sessions_no_strava`, never the `sessions` base table, a `strava_*` table or `backup_snapshots` (`.claude/skills/supabase-patterns.md`, "Strava data and agent sessions").

## Library documentation — Context7 first

The Context7 MCP connector is live in every session. **Never answer a library
question from memory, and never reach for WebSearch first.** Look it up:

1. `resolve-library-id` (`libraryName`, `query`) → a `/org/repo` id
2. `query-docs` (`libraryId`, `query`, optional `tokens`) → the docs

This binds on any API surface, config key, or version-specific behaviour in
React, Vite, Vitest, `@supabase/supabase-js`, `@testing-library/react`,
Recharts, `@tanstack/react-query`, ESLint and Prettier. Fall back to WebSearch
only when `resolve-library-id` returns nothing, or for tooling unlikely to be
indexed (Husky, lint-staged, vite-plugin-pwa).

**Name the source for every library claim you make** — "Context7" or the URL —
so a reader can tell a looked-up fact from a remembered one. An unsourced API
claim is a guess, and this repo has already shipped bugs from confident guesses
about library behaviour.

## READ-ONLY instruction template

If the stage brief says READ-ONLY: do not use Edit or Write, and do not run
state-changing Bash (no git commit/checkout, no file writes, no installs).
Your deliverable is your final report text only.
