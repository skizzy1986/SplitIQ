# Codex factory adapter

This adapter lets Codex run the factory without Claude Code hooks. The canonical chain, gates, stage briefs, runner preflight and recovery remain in [orchestrate](../.claude/skills/orchestrate/SKILL.md); [refactor](../.claude/skills/refactor/SKILL.md) governs extractions and [research](../.claude/skills/research/SKILL.md) research-only work. [WORKFLOW.md](../WORKFLOW.md) governs delivery. Root [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md) and [VISION.md](../VISION.md) remain binding.

For development work load the personal `codex-factory` skill. In-process is the default; use Kepler only if the canonical preflight succeeds and its runner can honor the required Codex models and context. Otherwise choose in-process before starting. Once selected, follow the canonical runner’s failure and recovery rules; do not switch to bypass a failed stage.

Codex overrides the canonical Claude model labels: Research and Story → `gpt-6.1-sol` high; Spec → `gpt-6-astra` high; Build/tests and refactor implementation → `gpt-6.1-terra` high; test verification and Code Reviewer → `gpt-6.1-sol` high; Reality Checker → `gpt-6-astra` high. Use explicit per-spawn model, reasoning and `fork_turns: none`; do not change the parent model. If a required model, agent or tool is unavailable, stop and report rather than substituting or self-reviewing.

For every stage, read and prepend the **full** [erg context](../.claude/skills/erg-context.md), then include the full matching persona file below and the canonical stage addendum. Add the focused task, relevant inputs and evidence, expected output, permissions and file ownership. Writers must be told they are not alone and must not revert others’ edits. Respect persona instructions only within the project’s higher-priority rules. The mapping comes from [agent routing](../.claude/AGENTS.md):

| Stage | Persona file |
|---|---|
| Codebase research | `.claude/agents/engineering-codebase-onboarding-engineer.md` |
| External research | `.claude/agents/product-trend-researcher.md` |
| Story | `.claude/agents/product-manager.md` |
| Spec | `.claude/agents/specialized-workflow-architect.md` |
| Backend build | `.claude/agents/engineering-backend-architect.md` |
| Frontend build | `.claude/agents/engineering-frontend-developer.md` |
| Refactor | `.claude/agents/engineering-minimal-change-engineer.md` |
| Test verification | `.claude/agents/testing-test-results-analyzer.md` |
| Code Reviewer | `.claude/agents/engineering-code-reviewer.md` |
| Reality Checker | `.claude/agents/testing-reality-checker.md` |

Before and after every READ-ONLY agent stage, run the installed factory skill’s `scripts/fingerprint.py` from the worktree root and compare. This Windows-compatible procedure replaces the canonical shell pipeline; it checks Git state plus tracked and non-ignored untracked file contents, including existing changes. Pause writers across each pair of checks. A mismatch or error fails the stage: stop, report and resolve it. READ-ONLY means no file or external-state mutation.

Maintain a concise stage ledger with evidence, approvals, verdicts and next action; carry it into handoff and PR notes. Present both independent review verdicts at Gate 3. Never infer approval. If an existing spec was explicitly approved, resume at Build and retain that approval in the ledger rather than repeating earlier gates. Plan mode permits planning only. Deliver only within the user’s authorizations and repository boundaries; subagents never commit, push or open a PR.

## Local verification

For Codex runs, use focused checks appropriate to the changed files. In `web/`, run
`npx vitest run --changed origin/main --passWithNoTests` before push; for stage 5
add `--coverage` and give the actual output to the Test Results Analyzer. Run
relevant targeted lint and other checks for the change, and report what ran and
any gaps. CI runs the full suite and enforces project-wide coverage thresholds.
For refactors, preserve the canonical extraction workflow and its build and test
requirements unless explicitly changed. This adapter records Codex’s verification
choice; it does not edit the canonical skills.
