# WORKFLOW — how work flows through SplitIQ

> The single, standing process for planning and shipping changes. It replaces
> the `coach/work-orders/` system (now deprecated). If you're new here, read this
> top to bottom once — it's short on purpose.

## The one rule

**Every change is a GitHub Issue → a branch → a Pull Request → CI → `main`.**

No work happens off this rail. The backlog lives in GitHub Issues, status lives
on a GitHub Projects board, and `main` is always releasable because branch
protection won't let anything in without green CI.

```
Idea ──▶ Issue ──▶ branch ──▶ commits ──▶ PR ──▶ CI gates ──▶ squash-merge ──▶ main
        (backlog)  (1 per     (small,     (Closes  (lint /     (delete
                    issue)     focused)     #N)     test /      branch)
                                                    build)
```

## 1. Backlog = GitHub Issues

Anything you might do becomes an Issue. Don't keep work in your head or in
scattered markdown files — if it's worth doing, it's worth one issue.

A good issue has:
- A clear, outcome-shaped **title** ("Deploy Google Health API vitals import",
  not "health stuff"). It is a plain sentence: the symptom for a bug, the outcome
  for a feature, `Epic: …` for an epic. **No `fix(scope):` prefix** — the `type:`
  and `area:` labels say that, and a second copy in the title drifts from them; the
  prefix belongs on the PR title (§3). No roadmap or decision IDs (`R12`, `D27`)
  either: they go in the body. `issue-title-lint.yml` fails on a new or retitled
  issue that has a prefix; an issue has no merge to block, so that is a red run,
  not a gate.
- A short **body**: what + why, and a checklist of acceptance criteria.
- **Labels** for priority and area (below).
- A **milestone** if it belongs to a themed batch of work.

### Labels

Every issue carries a stack-ranked priority (`P0`–`P3`), a `type:` label, and an `area:` label matching our core workstreams:

| Dimension | Labels | Purpose |
|---|---|---|
| **Priority** | `P0`, `P1`, `P2`, `P3` | Relative stack rank (re-sorted often) |
| **Type** | `type: epic`, `type: feature`, `type: bug`, `type: refactor`, `type: spike`, `type: chore`, `type: docs` | What kind of work it is |
| **Area** | `area: anatomy`, `area: coherence`, `area: factory`, `area: backend`, `area: mobile`, `area: design`, `area: a11y` | Subsystem domain (mirrors Kepler Task Groups) |
| **Automation state** | `routine-managed`, `needs-attention` | Set by workflows, never by hand: a scheduled Routine owns the issue; escalated when it misses its window (see *Doctrine SHA*) |

Priority is **relative and re-sorted often** — it's a stack rank, not a promise.

### Ideas that start in Discussions

Ideas and prototypes arrive in [Discussions](https://github.com/skizzy1986/SplitIQ/discussions),
not as issues. One worth building is **promoted**: it becomes an issue here, and the thread
is told so. The loop closes itself when the work ships.

1. **Promote.** Write the issue as usual, titled as an outcome ("When this ships, a user
   can…") with acceptance criteria, and put this line on its own in the body:

   ```
   Discussion: https://github.com/skizzy1986/SplitIQ/discussions/<n>
   ```

   `Discussion: #<n>` works too. Then reply on the thread with the issue link. The weekly
   *SplitIQ Discussion drafts* task drafts both and does them on Scott's `promote` reply.
2. **Build.** Branch, PR and merge as below. The PR closes the issue the normal way
   (`Closes #<issue>`). The `Discussion:` line is also read from the PR body, but the
   PR still names an issue in its title (§3).
3. **Ship.** When that PR merges into `main`, `.github/workflows/discussion-shipped.yml`
   replies on the thread: "Shipped: #PR closed #issue…". Nobody has to remember to.

That reply is the **one** Discussions write that posts without Scott approving the text. It
is a fixed template whose only variables are the PR and issue numbers. Everything else
written to Discussions goes through `post-discussion.yml` on his say-so
(see [`docs/CLOUD_ENVIRONMENT.md`](docs/CLOUD_ENVIRONMENT.md)).

Only a line that *starts* with `Discussion:` counts. Linking a thread anywhere else in an
issue or PR is a reference and triggers nothing. To re-send a missed reply, or to see what
a merged PR would post, dispatch `discussion-shipped.yml` with `pr=<number>`, adding
`dry_run=true` for the second.

## 2. One branch per issue

Cut every branch from a freshly-fetched `origin/main`:

```bash
git fetch origin && git checkout -b <type>/<issue>-<short-slug> origin/main
```

Branch **types**: `feature/`  `fix/`  `refactor/`  `housekeeping/`  `config/`.
The issue number leads the slug (`fix/567-logger-sheet-cutoff`), so a branch
says what it is for wherever it is listed. A session that is handed its branch
(Kepler below; a cloud session's `ccr-…` or `claude/…`) keeps the name it was
given. Branch names are convention, not a gate: a branch cannot be renamed
under an open PR, so a failed check there could not be fixed. The PR title
carries the number that is enforced (§3).
Keep branches short-lived and **rebase** (never merge) to stay current:

```bash
git fetch origin && git rebase origin/main
git push --force-with-lease origin <branch>   # safe force — never plain --force
```

One issue per branch keeps PRs small and reviewable. If a branch starts solving
two issues, split it.

**A Kepler task arrives with its branch and worktree already cut** —
`kepler/<issue>-<type>/<slug>`, or `kepler/<type>/<slug>` with no issue. Use it as it
is: do not cut a second branch or rename it. Rebase it before the first commit; it is
only as fresh as the task. No workflow reads a branch prefix (every `push` trigger is
`main` only, and `pr-title-lint` checks the PR *title*). After the merge, remove the
worktree with Kepler's `worktree_delete`, never `git worktree remove` or `git branch -D`.

## 3. Commit, then open a PR

- Small, focused commits; the pre-commit hook auto-formats staged JS/JSX.
- Open the PR early (draft is fine). Fill in the PR template
  (`.github/PULL_REQUEST_TEMPLATE.md`).
- **Link the issue** in the PR body with a closing keyword so merging
  auto-closes it:

  ```
  Closes #42
  ```

- **Title the PR `<type>(<scope>): <what the change does> (#<issue>)`** —
  `fix(strength): keep logger sheets inside the desktop window (#567)`. The
  title becomes the squash commit and GitHub appends the PR number, so every
  commit on `main` reads `… (#issue) (#PR)`: the last bracket is the PR, the one
  before it is the issue. Four rules follow from that:
  - **Never type the PR number.** GitHub adds it.
  - **One issue number, at the very end.** A PR that closes more lists the rest
    in the body (`Closes #N`), not the title.
  - **No other ID schemes in the title** — no `R12`, `D27`, `slice 11` or
    `PR 1/6`. The issue body carries them.
  - **Every PR has an issue**, however small. If there is none, file one first.

  `pr-title-lint.yml` enforces the type and the ending inside the required
  title check: the number must be an existing issue here, not a pull request
  and not the PR's own number. Dependabot PRs are the one exemption — they have
  no issue. A branch type is not a title type (`feature/` → `feat:`); the
  allowed title types are listed in that workflow.

## 4. CI gates (must be green to merge)

The web app's three jobs (`.github/workflows/ci-web.yml`, which skips them
unless `web/**` changed):

| Gate | Checks |
|---|---|
| **Lint & Format** | ESLint + Prettier + `check:design-sync` + `check:colours` + `i18n:check` + `npm audit --omit=dev --audit-level=high` (dev-only advisories are deliberately out of scope — an unscoped gate deadlocked the repo for a month in 2026-08; see the comment in `ci-web.yml`) |
| **Test & Coverage** | Vitest passes; coverage meets the ratcheting thresholds in `web/vite.config.js` |
| **Build** | `npm run build` exits 0, then `npm run size` (bundle budgets); runs after Test |

When `Lint & Format` is red, read the failing **step**: a green `npm run lint`
does not clear the other five.

The edge functions' job (`.github/workflows/ci-functions.yml`, skipped unless
`supabase/functions/**` changed):

| Gate | Checks |
|---|---|
| **Deno Tests** | the hardcoded test steps in `ci-functions.yml` pass (only functions with a step are tested), then `deno lint` over every function |

These are not the whole set. Many more workflows in `.github/workflows/`
report on a PR — `codeql`, `dependency-review`, `pr-title-lint`, `zone-bands`,
`ci-android`, `e2e-web`, `lighthouse` and others — each with its own job-level
path filter, and several are required. The required set lives in the
repository ruleset, not in this file: derive it as
`.claude/skills/steward/SKILL.md` (*What protects `main`*) describes, and do
not copy it here.

`main` is protected: no direct pushes, branch must be up to date, all required
checks green. A coverage comment posts automatically. The coverage numbers live in
**one place only** — `web/vite.config.js` (`test.coverage.thresholds`). Do not
mirror them into docs; they ratchet upward with every extraction and mirrored
copies drift.

### Sentry in CI (reporting, not gating)

Two Sentry surfaces observe PRs without blocking them:

- **Test Analytics** — the Test job uploads Vitest's JUnit XML via
  `getsentry/prevent-action`, giving flaky-test detection and per-test failure
  history. `fail_ci_if_error: false` on purpose: it is a reporting sink, and a
  Prevent outage must never fail a PR whose tests actually passed.
- **Seer Code Review** — enabled in the Sentry UI (not in this repo), it
  reviews PR diffs for defects likely to reach production and posts a status
  check. Comment `@sentry review` on a PR to request one on demand.

Neither replaces the four gates above. A red Sentry signal is information;
the gates are the contract.

## 5. Merge and clean up

- **Squash-merge** to keep `main` history linear and one-commit-per-issue.
- Delete the branch.
- The linked issue closes itself via `Closes #N`; the Projects board moves it to
  Done.

---

## The design lane

Design work rides the same rail as everything else — Issue → branch → PR → CI → `main`,
labelled `area: design` (and `area: a11y` where relevant), on the Split IQ board. Two extra rules:

- **A PR that changes what the app looks like carries visual evidence** — a screenshot or
  a baseline diff, reviewed in the PR.
- **Stay on one side of the property boundary.** Colour hexes belong to #183,
  `padding`/`margin`/`gap`/`borderRadius` to S6, and the `font*`/`letterSpacing`/
  `lineHeight` family to S-1. The three sets are disjoint so the workstreams can run in
  parallel without colliding in the same line. Check your own diff; this is a judgement,
  not a CI gate.

The documents, and which one wins, are in **[`DESIGN.md`](DESIGN.md)**. Re-syncing the
claude.ai/design project is an owner action — it needs an interactive `/design-login` and
cannot be done from a remote agent session.

## The status board — "Split IQ" (GitHub Projects)

The **Split IQ** board ([projects/1](https://github.com/users/skizzy1986/projects/1)) is
the at-a-glance answer to "what's happening." All work is directed through it. Columns:

```
Backlog  →  Ready  →  In progress  →  In review  →  Done
```

| Move | How |
|---|---|
| New issue/PR → **Backlog** | Automatic: *Auto-add to project* + *Item added to project* |
| Reopened → **Backlog** | Automatic: *Item reopened* |
| **Backlog → Ready** | **By hand**: triaged and worth doing next |
| **Ready → In progress** | **By hand**: when you cut the branch |
| Issue → **In review** | Automatic: *Pull request linked to issue* — fires on `Closes #N` in the PR body (the PR template already carries it; see §3). It moves the linked **issue**; the PR's own card stays in Backlog until it merges |
| → **Done** | Automatic: *Item closed* + *Pull request merged* |

GitHub has no trigger for "triaged" or "branch created", so those two moves stay manual.
Cloud sessions read the board and make the two manual moves through
`.github/workflows/project-board.yml` — see [`docs/CLOUD_ENVIRONMENT.md`](docs/CLOUD_ENVIRONMENT.md).

### Roadmap fields (added 2026-11-07)

Four custom fields carry the product roadmap ([`docs/ROADMAP.md`](docs/ROADMAP.md), epic
#432) onto the board, so a **Roadmap** layout can draw it:

| Field | Type | Values | Meaning |
|---|---|---|---|
| **Horizon** | single select | `H0 Foundations` · `H1 Squat` · `H2 Movements` · `H3 Coach surfaces` · `Maintenance` | Which roadmap horizon the item belongs to; `Maintenance` is everything that is not roadmap work |
| **Size** | single select | `S` · `M` · `L` | ≤ half a day · ≈ a day · 2+ days, the roadmap's own scale |
| **Start** / **Target** | date | `YYYY-MM-DD` | The **horizon's planning window**, not a per-item commitment: H0 2026-11-07 → 2026-12-19, H1 2026-11-21 → 2027-02-28. Later horizons get dates when they are approved. |

`project-board.yml` grew two actions for them. `fields` creates any of the four that is
missing (idempotent). `set` takes one line per item and sets any field by name, Status
included, in a single run — which matters because **the concurrency group keeps only one
pending run**, so several dispatches queued at once cancel all but the last:

```
433|Horizon=H0 Foundations|Size=S|Start=2026-11-07|Target=2026-12-19|Status=Ready
```

`list` now prints the four columns beside Status.

### Views worth having (owner clicks; views cannot be created through the API)

1. **Board** by Status — the existing view; the day-to-day answer to "what's happening".
2. **Roadmap** — layout *Roadmap*, date fields *Start → Target*, group by **Horizon**,
   markers on *Target*. Filter `-horizon:Maintenance` so only roadmap work draws.
3. **Epic tree** — layout *Table*, group by **Parent issue**, columns Status · Horizon ·
   Size · Target. Sub-issues of #412 and #432 fall into their epics automatically.
4. **Now** — layout *Board*, filter `status:Ready,"In progress","In review"`, group by
   Status, sorted by Horizon. The short list for a 30-minute gap.

The built-in *Auto-add sub-issues* workflow (on) means a new sub-issue of an epic lands
on the board with its parent set; give it a Horizon and Size with `set` and it appears in
every view above.

> **Built-in workflows (configured 2026-11-05, *Project → ⋯ → Workflows*).**
> **On:** Auto-add to project (repo `SplitIQ`, filter `is:issue,pr is:open`) ·
> Item added to project (issues + PRs → Backlog) · Item reopened (→ Backlog) ·
> Pull request linked to issue (→ In review) · Item closed (→ Done) ·
> Pull request merged (→ Done) · Auto-close issue (default) · Auto-add sub-issues (default).
> **Off:** Auto-archive items · Code changes requested · Code review approved.

> **Committed auto-add fallback.** `.github/workflows/add-to-project.yml` adds new
> issues/PRs to Split IQ from CI as a belt-and-suspenders layer behind the built-in
> auto-add rule. It stays a **no-op until** you add the `ADD_TO_PROJECT_PAT` secret,
> because the default `GITHUB_TOKEN` can't write to a user-owned project. To enable:
> create a **classic PAT** with `project`, `read:org` and `read:discussion` (the last two
> are what `project-board.yml`'s `gh project` calls need; see
> [`docs/CLOUD_ENVIRONMENT.md`](docs/CLOUD_ENVIRONMENT.md)), add it as repo secret **`ADD_TO_PROJECT_PAT`**, then set the board's
> project number in `project-url` inside that workflow.

---

## How this composes with the software factory

The `.claude/` factory pipeline (`/feature`, `/orchestrate`, `/refactor`,
`/research` — defined in `.claude/skills/orchestrate/SKILL.md`, explained in
`FACTORY.md`, staffed by the Agency agent library) is **how a single issue gets
built**, not a competing tracker. It already ends in *PR → CI → merge*, so it
slots straight into this rail:

```
Issue ──▶ /feature or /orchestrate ──▶ research → story → spec → build+test
      │                                        → verify → review+validate
      └─────────────────────────────────────────────────▶ PR (Closes #issue)
```

Pick an issue, run the pipeline (or hand-build for small changes), and the output
is a PR linked back to the issue. Same rail, every time.

Run from a Kepler session, the build stage and the two judges are Kepler child sessions
instead of in-process subagents. The chain, the gates and the output are the same; the
difference is stated once, in the skill's *Runner* section.

## Doctrine SHA

The `doctrine_sha` anchor (Supabase `anchors` table) pins the canonical commit of
the doctrine docs — `CLAUDE.md` + `.claude/skills/training-science.md` — so Code
and Coach agree which doctrine version is live. **When you change either doc, the
anchor must be superseded to the new `main` commit.** That update is a DB write in
Coach's content lane (Scott authorises), not a git change.

You don't have to do it either. Three parts, all in
`.github/workflows/doctrine-sha-guard.yml` except the Routine:

1. **Guard** (push to `main` touching those docs) opens, or comments on, one
   unassigned tracking issue labelled `routine-managed`, carrying the new SHA. It
   is a pending marker, not a to-do.
2. **Routine** — the `Supabase Doctrine_SHA anchor update` Claude Code Routine runs
   at 01:00 UTC, supersedes the anchor and closes the issue. Its prompt lives in
   the Routine, not in git.
3. **Watchdog** (03:17 UTC daily) looks for a `routine-managed` issue opened
   before the latest 01:00 UTC that is still open. Closing the issue is the
   Routine's success signal, so a survivor means the Routine missed its run: the
   watchdog comments once, adds `needs-attention`, assigns the owner, and fails
   the run every day until the issue closes. Dispatch it with `dry_run` to see
   what it would do.

Act only on a `needs-attention` issue: check the Routine first, then supersede by
hand if it cannot run. The watchdog cannot see the database, so it trusts the
close; a Routine that closed the issue without writing the anchor would pass.

## Database migrations

- **Merged is not done.** A migration PR is done only when the migration is
  applied to production, read back, recorded in
  `supabase/migrations/manifest.json`, and the read-back is pasted in the PR body.
  #429 is what happens otherwise: a merged migration sat unapplied and nothing
  noticed.
- **Apply** with the Supabase MCP `apply_migration` tool, `name` exactly the file
  stem (`014_revoke_default_function_execute`, not a paraphrase), in Plan mode
  (see `docs/CLOUD_ENVIRONMENT.md`). Scott approves every apply. Rollback files are
  never applied automatically.
- **Order.** After Gate 3 approval and green CI: apply from the final reviewed SQL,
  flip the manifest entry to `applied` with the version `list_migrations` reports,
  push, paste the read-back, merge. If the PR must merge first, the entry lands as
  `pending`, and the nightly drift check flags it until a follow-up PR flips it.
- **Read-back contents:** the `list_migrations` row; a `SELECT` proving the change
  took; the security advisor summary; the role the apply ran as
  (`select current_user`).
- **Naming and rollback.** `NNN_snake_case.sql` with the next free number, and
  `NNN_…_rollback.sql` alongside it (enforced from 014 on).
- **Two guards.** `Migrations manifest is consistent` runs on every PR that touches
  migrations; it has no DB access, so it checks the manifest against the files only.
  The nightly drift check (`docs/routines/migration-drift-check.md`) compares the
  manifest with production and opens the issue titled
  `chore(db): production migrations drifted from supabase/migrations/manifest.json`.
  Fix drift by applying the migration or correcting the manifest — never by
  weakening the check.

Unlike the `doctrine_sha` Routine, this scheduled task's prompt is committed.

## Project-management agents

The Agency agents the factory uses are in `.claude/agents/` (routing map:
`.claude/AGENTS.md`). The most useful
for running this workflow:
- **`product-manager`** / **`product-sprint-prioritizer`** — decide what's next,
  re-rank the backlog.
- **`project-management-project-shepherd`** — track in-flight issues/PRs and flag
  stalls.
- **`senior` project manager** (`project-manager-senior`) — turn a rough idea
  into well-formed, sequenced issues.

These are generic — always prepend `.claude/skills/erg-context.md` (the
canonical spawn preamble) when invoking them. Deeper domain knowledge lives in
`.claude/skills/`.

---

*Supersedes `coach/work-orders/WORK_ORDERS.md`. Adopted 2026-06-29.*
