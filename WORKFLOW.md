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
| **Area** | `area: anatomy`, `area: coherence`, `area: factory`, `area: backend`, `area: mobile`, `area: design`, `area: a11y` | Subsystem domain; each has one Kepler task group (see *Picking up work in Kepler*) |
| **Automation state** | `routine-managed`, `needs-attention` | Set by workflows, never by hand: a scheduled Routine owns the issue; escalated when it misses its window (see *Doctrine SHA*) |
| **Epic** | `epic: <n> <name>`, e.g. `epic: 432 roadmap` | Set by `epic-labels.yml`, never by hand: which epic an issue or PR belongs to (see *Epics*) |

Priority is **relative and re-sorted often** — it's a stack rank, not a promise.

### Epics

An epic is an **outcome that needs more than one PR and has a finish line**: one
sentence in its body saying when it is done. Every piece of work toward it is a
sub-issue. A theme with no end is an `area:` label, not an epic. A roadmap horizon
or track is a phase, recorded in the board's **Horizon** field, not an epic. (Applied
2026-11-16: #382 went from `type: epic` to `type: feature`, its work being #432's H1;
the Language track got its epic, #597.)

An epic is an issue labelled `type: epic`, and **its issue number is the epic's
one identifier**. There is no second numbering scheme for its slices.

- **An epic gets Start and Target on the board when it is filed** (`project-board.yml`,
  action `set`), so it draws as one bar on the Roadmap view (*Views*, below). Target is a
  working target, revised as work lands.
- **File each slice as a sub-issue of the epic** (*Create sub-issue* on the epic,
  or `issue_write` with `parent_issue_number` from a session). The sub-issue
  hierarchy is the source of truth: the epic shows its own progress, and an agent
  reads the whole epic in one call. A "Part of #n" line in a body links nothing.
- **`epic-labels.yml` copies the epic's label onto every descendant and onto each
  open PR whose title names one** (`epic: 432 roadmap`). Sub-issues do not show
  in the issue or PR lists; the label does, so one glance or one filter finds an
  epic's whole body of work. Never apply or remove an `epic:` label by hand — the
  next run puts it back the way the hierarchy says.
- **Titles do not carry the epic number.** A PR title ends with its slice's
  issue number (§3) and nothing else.
- Making an *existing* issue a sub-issue fires no workflow event, so the label
  arrives with the daily run. Dispatch `epic-labels.yml` to have it at once.
- A new epic works with no setup: it is given a bare `epic: <n>` label. Give it
  a name in `.github/labels.yml` when it has one.
- **A new epic label, or a renamed one, goes on Kepler's skip list:** Kepler →
  Automations → *Plan issues assigned to me* → Edit → *Without labels*. Miss it and
  the epic's sub-issues start getting their own tasks again (*Picking up work in
  Kepler*, rule 2).

### Picking up work in Kepler

Work is grouped in three places: the epic (sub-issues), the labels, and Kepler task
groups. These rules say how they fit together (decided 2026-11-16, #593; rule 1
revised the same day, #599, after one task per sub-issue left many task pages and
every session starting cold).

1. **An epic gets one Kepler task; each sub-issue is a worktree inside it.** When an
   epic spans roadmap horizons it gets **one task per horizon** instead, so no task
   page gets overwhelming (#432 → one task for H0, one for H1). The task links the
   epic and sits in the group for the epic's area (rule 3).
   - Each sub-issue gets its own worktree in that task, on its own branch
     `kepler/<sub-issue>-<type>/<slug>`, with its own session and its own PR whose
     title ends `(#<sub-issue>)`. One PR per issue still holds. **The branch is named
     after the sub-issue, never the epic:** a `kepler/<epic>-…` branch is one no single
     PR can close, which is how #565 and #582 both ended up closing #520.
   - Work through it in order: the next slice branches from `main` once the last one
     merges, or from the last one's branch to keep going before it merges (record the
     stacked target with `worktree_update`).
   - The task's notes carry what each slice learned into the next session. That is why
     it is one task.
   - If the work has no sub-issue yet, file one under the epic first. Each epic is also
     a tab in the Kepler Dashboard.
2. **Picking up an issue means assigning it to yourself.** The assignee is the claim
   (#543): an assigned issue is taken, an unassigned one is free. Unassign yourself if
   you drop it.
   - A **standalone issue** gets its own task: Kepler's *Plan issues assigned to me*
     automation makes the Plan task and its branch (§2).
   - A **sub-issue** does not. The automation skips it because it lists **every epic's
     label under *Without labels*** (its form cannot take a raw `no:parent-issue`
     filter). Picking up a sub-issue means assigning yourself and adding its worktree
     to the epic's (or horizon's) task. Filing or renaming an epic label means
     updating that list (*Epics* above).
3. **Each area has one Kepler task group**, named exactly as below:

   | Area label | Kepler task group |
   |---|---|
   | `area: anatomy` | Anatomy Engine |
   | `area: coherence` | Product Coherence |
   | `area: factory` | Factory & Workflow |
   | `area: backend` | Backend & Reliability |
   | `area: mobile` | Mobile |
   | `area: design` | Design |
   | `area: a11y` | Accessibility |

   Kepler only creates a group when the first task goes into it, so a group can be
   missing until its area has work. Create it with the name above, spelled exactly.
   A review runs when Scott starts one, as a session in the epic's task or the issue's
   task (Kepler's *SplitIQ Stage 6 PR Review* automation was deleted 2026-11-16).
4. **One source of truth per dimension.** Anything else showing that dimension is a
   copy. Where they disagree, fix the copy.

   | Dimension | Source of truth | Copies |
   |---|---|---|
   | Epic | The parent issue (sub-issue hierarchy) | `epic:` label, Dashboard tab |
   | Area | The `area:` label | Kepler task group |
   | Priority | The `P0`–`P3` label | — |
   | Status | The Kepler stage, and the PR's state | Split IQ board Status |

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

**A Kepler task, or a sub-issue's worktree in its epic's task (§1), arrives with its
branch and worktree already cut** —
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
| Issue → **In review** | Automatic: *Pull request linked to issue* — fires on `Closes #N` in the PR body (the PR template already carries it; see §3). It moves the linked **issue**; the PR's own card stays in Backlog until it merges |
| → **Done** | Automatic: *Item closed* + *Pull request merged* |

**The two hand moves, Backlog → Ready and Ready → In progress, are retired (2026-11-16,
#593).** Nothing has to move a card by hand. Both moves were hand-kept copies of facts that
now have a source of truth (*Picking up work in Kepler*, rule 4). "Worth doing next" is the
`P0`–`P3` label. "Being worked on" is the assignee plus the Kepler stage. A third copy kept
by hand only drifts from the other two. The Ready and In progress columns stay, because
`project-board.yml` and existing `set` lines name them, but nothing reads them. A card left
in Backlog until its PR opens is correct.

Cloud sessions read the board, and set the roadmap fields below, through
`.github/workflows/project-board.yml` — see [`docs/CLOUD_ENVIRONMENT.md`](docs/CLOUD_ENVIRONMENT.md).

### Roadmap fields (added 2026-11-07)

Four custom fields carry the product roadmap ([`docs/ROADMAP.md`](docs/ROADMAP.md), epic
#432) onto the board, so a **Roadmap** layout can draw it:

| Field | Type | Values | Meaning |
|---|---|---|---|
| **Horizon** | single select | `H0 Foundations` · `H1 Squat` · `H2 Movements` · `H3 Coach surfaces` · `Maintenance` | Which roadmap horizon the item belongs to; `Maintenance` is everything that is not roadmap work |
| **Size** | single select | `S` · `M` · `L` | ≤ half a day · ≈ a day · 2+ days, the roadmap's own scale |
| **Start** / **Target** | date | `YYYY-MM-DD` | On an **epic**, its own run, set when it is filed; Target is a working target, revised as work lands (§1 *Epics*). On other items, the **horizon's planning window**, not a per-item commitment: H0 2026-11-07 → 2026-12-19, H1 2026-11-21 → 2027-02-28. Later horizons get dates when they are approved. |

`project-board.yml` grew two actions for them. `fields` creates any of the four that is
missing (idempotent). `set` takes one line per item and sets any field by name, Status
included, in a single run — which matters because **the concurrency group keeps only one
pending run**, so several dispatches queued at once cancel all but the last:

```
433|Horizon=H0 Foundations|Size=S|Start=2026-11-07|Target=2026-12-19|Status=Ready
```

`list` now prints the four columns beside Status.

### Views (owner clicks; views cannot be created through the API)

The board has five views (set 2026-11-16, #599). The old Table, Status Board and My
items views were deleted.

| Tab | Layout | Filter | Group / sort | Answers |
|---|---|---|---|---|
| **Now** | Table | `is:open label:P0,P1` | Group **Assignees**, sort **Horizon** | What is claimed, and what is free (*No assignees*) |
| **Epics** | Table | `is:open` | Group **Parent issue** | Each epic's open sub-issues and their status |
| **In review** | Table | `is:open status:"In review"` | (none) | What waits on a PR to land |
| **Roadmap** | Roadmap | `label:"type: epic"` (no `is:open`, so finished epics stay as history) | Dates **Start → Target**, markers on Target, sort by Start, column **Sub-issues progress** | One bar per epic: how long it runs and how far it has got |
| **Bugs** | Table | `is:open label:"type: bug"` | Sort **Labels** | What is broken |

The Ready and In progress columns are no longer kept (#593), so no view filters on them.

The built-in *Auto-add sub-issues* workflow (on) means a new sub-issue of an epic lands
on the board with its parent set, so it appears under its epic in the Epics view; give it
a Horizon and Size with `set`.

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
