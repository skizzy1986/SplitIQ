---
name: orchestrate
description: Run the canonical factory chain (research → story → spec → build+test → verify → review+validate → PR) staffed by Agency-library agents, with three human approval gates. Use for any new feature, bug fix, or significant change.
argument-hint: <rough feature idea or bug>
---

Run the canonical factory pipeline for `$ARGUMENTS`. This file is THE single
definition of the pipeline — `/feature` is an alias for it.

## You are the orchestrator

You (the main conversation) drive the chain — there is no orchestrator agent.
You route work to Agency-library agents — in-process subagents, or Kepler
sessions for the stages *Runner* names; you do not do their jobs yourself.
Reads run in parallel, writes run in sequence. STOP at each human approval gate
and wait for Scott.

## Spawn protocol (every stage)

1. Read `.claude/skills/erg-context.md` and prepend its FULL contents to the
   agent's prompt (a subagent prompt, or a Kepler session's first message) —
   Agency agents are generic; this block makes them erg-aware.
2. Append the stage addendum below, then the task itself.
3. Pin the stage model via the Agent tool's per-call `model` parameter (a Kepler
   session: `modelId`).
4. For READ-ONLY stages: fingerprint the tree before and after the spawn —
   `{ git status --short; git diff HEAD; git ls-files -o --exclude-standard -z | xargs -0 -r git hash-object; } | git hash-object --stdin`
   — and compare. A different hash is a stage failure — report and stop. (Plain
   `git status --short` cannot see an edit to a file Build already changed.)
5. That preamble carries the **Context7 first** rule, so every subagent inherits
   it automatically — no per-stage repetition needed. It binds you too, in the
   stages you run yourself (5 and 7): resolve library facts through
   `resolve-library-id` → `query-docs` before WebSearch, and name the source.

## Runner — where a stage runs

Decide once, before stage 1, and tell Scott which runner you are on.

- **In-process** — the default, and the only runner in a cloud session, the
  `claude.yml` action or a collaborator's clone. Every stage is a subagent of
  this conversation, exactly as the protocol above says.
- **Kepler** — only when the `mcp__kepler-workspace__*` tools are present AND
  `task_get({ detail: "full" })` returns this session's task with a live place
  (a plain repeat call returns only what changed, so it can omit the places).
  Stages 4 and 6 then run as Kepler child sessions; 1, 2, 3 and 5 stay
  in-process subagents; 7 stays with you. A missing tool or a failed `task_get`
  means in-process for the whole run, and Scott can force in-process by saying so. Read `kepler-runner.md`
  (beside this file) now, before stage 1 — it holds the preflight, how a
  session's first message is composed, the wait loop and the run ledger.

| Stage | `role` | `mode` | `modelId` | `taskContext` |
|---|---|---|---|---|
| 4 Build + tests (each builder) | `delegate` | `edit` | `opus` | `true` |
| 6 Code Reviewer | `reviewer` | `plan` | `sonnet` | `false` |
| 6 Reality Checker | `reviewer` | `plan` | `opus` | `false` |

Always pass `mode` and `modelId`: an omitted one inherits yours. Once a run is on
the Kepler runner it stays there — a `session_start` that fails is a stage
failure, and `awaiting-approval` is a wait; never run that stage in-process to
get round either.

`agentId` is omitted, which means Claude Code. It is the seam for another agent
from `agent_list` (`codex`): a row may name one only with a `modelId` that agent
lists, and only after a session of that agent is shown to load the repo-root
`AGENTS.md` — it reads neither `CLAUDE.md` nor the hooks. No stage uses it yet.

## Routing — classify the request first

| Type | Signal | Path |
|---|---|---|
| New feature | "Add X", "Build Y" | Full chain (all stages) |
| Bug fix | "It's broken", "Fix X" | Skip Story — Research → Spec → Build → … |
| Refactor | "Extract X", "decompose" | Use `/refactor` instead |
| Research only | "How would we…", "Investigate" | Use `/research` instead |

State your classification to Scott before starting. If unclear, ask one
focused question.

## The chain

1. **Research (codebase)** — spawn `Codebase Onboarding Engineer` (model: sonnet, READ-ONLY).
   Task: map the relevant files and functions, existing patterns to follow, the
   Supabase data surface involved, and risks/gotchas. Cite exact paths and line
   numbers. Do not propose a solution — that is the Spec stage's job.
   Where the map touches a library boundary, settle the library's actual
   behaviour with Context7 rather than asserting it — WebSearch is the fallback.

2. **Story** — spawn `Product Manager` (model: sonnet, READ-ONLY).
   Task: one-screen user story — "As Scott, I want <capability>, so that
   <value>"; numbered, testable acceptance criteria; edge cases (empty/null
   data, RLS/auth, `MM/DD/YY` dates, slow network); an explicit out-of-scope
   list. Do not design the solution.

   → **GATE 1 (Scott): right problem? criteria correct?** Wait for approval or edits.

3. **Spec** — spawn `Workflow Architect` (model: opus, READ-ONLY).
   Task: turn the approved story + research into a build-ready technical brief:
   exact file paths per architecture layer, data changes (tables, columns,
   hooks, constants), component props (explicit even without TypeScript), and
   an explicit scope boundary. No implementation code.

   → **GATE 2 (Scott): design safe? red flags?** No code is written before approval.

4. **Build + tests** — spawn `Backend Architect` and/or `Frontend Developer`
   (model: opus; WRITES). Sequence backend → frontend when dependent; run
   concurrently only if they touch different files. Both builders MUST ship a
   Vitest/RTL test per acceptance criterion in the same change — there is no
   separate test-writing stage. Kepler runner: each builder is a Kepler session
   — see *Runner*.
   - *Backend addendum:* migrations are additive and reversible — any
     destructive change requires a fresh `backup_snapshots` row + Scott's
     approval (stop and ask). RLS stays on; never `BYPASSRLS`. Ingestion is
     idempotent upsert on a natural key. Edge functions are Deno under
     `supabase/functions/<name>/` with a pure, separately-testable parser.
     Run the Supabase security/perf advisors after DDL. Patterns:
     `.claude/skills/supabase-patterns.md`. Check any `@supabase/supabase-js`
     or Deno API you are not certain of against Context7 before writing against
     it. Do not touch frontend.
   - *Frontend addendum:* match inline-style theming, the nav-tab structure,
     `supabaseClient` for data, the single `formatDate` helper. After editing
     any large file, run `npm run build` as a truncation check. Never hardcode
     the user; respect RLS. No new heavy deps unless the spec names them.
     Layer rules: `.claude/skills/architecture.md`. Check any React, Recharts or
     `@tanstack/react-query` API you are not certain of against Context7 before
     writing against it. Do not touch backend/migrations.

5. **Test verification** — YOU run `npm test` and the coverage report, then
   spawn `Test Results Analyzer` (model: sonnet, READ-ONLY) with the output and
   the acceptance criteria. Task: interpret the results, flag untested criteria
   and coverage gaps honestly. Conventions: `.claude/skills/testing-patterns.md`.

6. **Review + Validate** — spawn both judges in parallel (READ-ONLY; Kepler
   runner: two Kepler sessions — see *Runner*):
   - `Code Reviewer` (model: sonnet): judge the diff — correctness vs the spec,
     layer compliance, security (no hardcoded credentials, RLS considered, no
     unsanitised `dangerouslySetInnerHTML`), style (inline styles, no
     TypeScript, no leftover `console.log`), tests present. Flag any library
     API the diff relies on that was asserted from memory where Context7 would
     have settled it.
     Verdict: **APPROVE / REQUEST CHANGES** with numbered findings.
   - `Reality Checker` (model: opus): judge built-vs-story/spec. Evidence =
     test output, build logs, git diff — no screenshots required. Findings by
     severity: **Blocker** (violates an acceptance criterion, breaks the build,
     bypasses RLS, risks data loss, commits a secret, introduces TypeScript);
     **Should-fix** (diverges from the spec, misses an edge case, ignores the
     date rule); **Nice-to-have** (style/consistency).
     Verdict: **ship / fix-then-ship / rework**.

   → **GATE 3 (Scott): ship?** Present both verdicts in full. Wait.

7. **Deliver** — you, in the main thread, per `WORKFLOW.md`:
   - *Branch.* In-process: create a feature branch (`git checkout -b
     feature/<kebab-slug>`). Kepler: the task's branch and worktree already
     exist (`WORKFLOW.md` §2) — stay on `git branch --show-current`. If it is
     behind, `git fetch origin && git rebase origin/main`, and rerun stage 5 if
     that moved anything.
   - Stage only the relevant files, commit with a descriptive message,
     `git push -u origin <branch>`, open a PR with `Closes #N` (Kepler: `N` is
     the number in `kepler/<N>-<type>/<slug>`; no number means ask Scott). The
     PR title is a Conventional Commit whose type is in
     `.github/workflows/pr-title-lint.yml` — a branch type is not a title type
     (`feature/` → `feat:`).
   - Kepler: put the ledger's stage lines and both verdicts in the PR body,
     then `task_get({ refresh: true })`. A PR whose base is not `main`:
     `worktree_update`.
   - Confirm CI gates + the Vercel preview.

Keep a short running summary of where we are in the chain. Never skip a gate.
If a stage fails, report and stop — do not improvise past a gate.

ARGUMENTS: $ARGUMENTS
