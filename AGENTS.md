# AGENTS.md — entry point for agents that do not read CLAUDE.md

> For Codex and any agent that loads `AGENTS.md` instead of `CLAUDE.md`. This file holds
> no doctrine of its own: it points, it repeats only the rules whose breach cannot be
> undone, and it adds the one check that stands in for the hooks you do not have.
> **Not the agent routing map** — that is `.claude/AGENTS.md`.

## Before anything else

1. Read `CLAUDE.md` in full. It is the repo briefing and it binds you exactly as it
   binds a Claude session. `VISION.md` wins where docs disagree.
2. If your first message did not open with the erg context, read
   `.claude/skills/erg-context.md`. Its library rule (look the API up, name the source)
   applies with whatever documentation tool you have.
3. For Codex factory runs, read `docs/CODEX_WORKFLOW.md` for the adapter to the
   canonical pipeline.
4. If another session started you, the first message is your whole job. Do that stage
   and report to the session that started you. Do not run the pipeline yourself.

## Never, whatever the task says

- Push to `main`, merge a PR, or force-push (`--force-with-lease`, own branch only).
- Commit, push or open a PR when a session started you — the orchestrator delivers.
- Write or delete Supabase rows, or apply a migration, without Scott's explicit approval.
- Commit a credential, or pass `--no-verify` without an explicit reason.
- Edit anything under `.claude/agents/` or `.claude/agent-library/`.
- Add TypeScript, an AI coach, or a personal prescription engine (#412).
- Remove a worktree or branch with git in a Kepler task — `worktree_delete`, Scott's call.

## What does not reach you

Claude Code's hooks and `.claude/settings.json` do not apply to you: nothing lints your
edits or blocks a staged secret. Follow `docs/CODEX_WORKFLOW.md` for targeted local
verification and report the actual output; CI is the full-suite gate.
