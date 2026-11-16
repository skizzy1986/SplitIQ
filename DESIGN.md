# DESIGN — how SplitIQ's look is decided and where it is written down

> The design workstream produced a full UI & IA brief, a light redesign, a synced
> component library on claude.ai/design, and a sequenced plan to get there. All of it
> lived in a hidden dotfolder and was referenced from nowhere. This file is the front
> door. Read it before changing anything visual.

## The documents, in authority order

| Document | Kind | What it settles |
|---|---|---|
| [`web/.design-sync/HANDOFF.md`](web/.design-sync/HANDOFF.md) | **Normative** | The light redesign: palette, the `var(--color-*)` token seam, the role rename, Archivo weight 500, the component inventory, the order of work. Highest authority. |
| [`web/.design-sync/DESIGN_BRIEF.md`](web/.design-sync/DESIGN_BRIEF.md) | **Prescriptive** | Diagnosis and the historical IA target (superseded by VISION.md: four destinations on desktop and mobile), the type and spacing scales, slices S-1…S7. Where the handoff is silent, this decides. |
| [`web/.design-sync/CLAUDE.md`](web/.design-sync/CLAUDE.md) | **Briefing** | What a Claude Design session needs to know about SplitIQ: the domain, the destinations, which numbers are real, the chart rules. The design-side mirror of the repo's `CLAUDE.md`. |
| [`web/.design-sync/conventions.md`](web/.design-sync/conventions.md) | **Style guide** | Tokens, accent pairs, type, layering, chart rules, and the gotchas the design side has already paid for. Light-primary. Inlined into the design agent's prompt, so it is the one file guaranteed to be read. Mirror — the project holds the source. |
| [`web/.design-sync/designs/`](web/.design-sync/designs/) | **The designs** | Self-contained historical HTML artboards; their old destination counts are superseded by VISION.md. Open in a browser, no build step. Compiled snapshots — the editable `.dc.html` source lives in the design project. Do not edit; they are overwritten on sync. |
| [`web/.design-sync/splitiq-load.js`](web/.design-sync/splitiq-load.js) | **The model** | The one module every artboard reads for form, CTL/ATL/TSB, `tsbBand()`, readiness and `readinessSeries()`, the six-zone table, erg watts/splits and e1RM. `HANDOFF.md` §5 asks the app for the same single `lib/load.js`. Numbers that are matched rather than derived drift. |
| [`web/.design-sync/splitiq-light-tokens.css`](web/.design-sync/splitiq-light-tokens.css) | **The tokens** | The full light declaration list with every contrast ratio measured. What the flip (`#251`) implements. |
| [`web/.design-sync/PROJECT-CONTEXT.md`](web/.design-sync/PROJECT-CONTEXT.md) | Mechanics | The design project's own briefing: which side owns what, and what neither side can see. Mirror — the project holds the source. |
| [`web/.design-sync/ISSUES-load-states.md`](web/.design-sync/ISSUES-load-states.md) | Spec | The load pending and unavailable states, written as two ready-to-open issues. |
| [`web/.design-sync/CODE-TO-DESIGN.md`](web/.design-sync/CODE-TO-DESIGN.md) | Handover | The reciprocal of `HANDOFF.md` — what the code side did, where the spec meets reality, and what each side still owes the other. Paste into a design session to re-sync. |
| [`web/.design-sync/NOTES.md`](web/.design-sync/NOTES.md) | Runbook | Sync gotchas, the incident log, and the reconciliation of the handoff against the code. |
| [`web/.design-sync/STATE_OF_PLAY.md`](web/.design-sync/STATE_OF_PLAY.md) | Status | A dated snapshot. Goes stale fast — trust it least. |

**Prescriptive vs descriptive is load-bearing.** `conventions.md` is shipped to the
design agent as a description of reality. When it describes a target instead, every
generated design codes against a system that does not exist. That has happened once
already; see the reconciliation note in `NOTES.md`.

## Where the state actually is

The palette's fallback is light (#287). Dashboard and anatomy theme controls use
Light / Dark / Auto and share `splitiq.theme`; Auto follows the OS when no explicit
choice is stored. The legacy strength logger stays explicitly light until #79.

**Dark is retained as a second theme, not deleted.** `HANDOFF.md` §1 says dark is
"dropped"; the design project's own `conventions.md`, revised 2026-08-22, overturns that
in review — the erg room is dark at 5am and the live screen wants it. Light is primary and
new work is designed on the light ground, but the dark values stay. Where the two
disagree, `conventions.md` is newer.
`web/src/constants/themeValues.js` holds the `LIGHT` and `DARK` palettes and sets
`DEFAULT_THEME = LIGHT`. `web/src/main.jsx` emits it as `var(--color-*)` custom
properties at `:root`, `DARK` under `[data-theme='dark']`, and the light palette
under `[data-theme='light']` so a nested light surface can override a dark shell. `web/src/constants/theme.js` is a pointer table of `var(--color-*)`
strings with no hexes in it. `themeValues.js` is the only file allowed to write a
palette hex down. The few off-palette literals left (mostly `StrengthLogger.jsx`, plus
a few `#666` fallbacks) are pinned per file and per hex by `npm run check:colours`.

## The squat tool — a public surface

`/squat` (`web/src/squat/`) is SplitIQ's first page for people who are not Scott:
coaches and athletes, signed out, on a phone as often as a desk. It reuses the system
rather than forking it — `THEME` pointers, `FONT.sans` (Archivo) for language and
`FONT.mono` (IBM Plex Mono) for every measurement, the `SPACE`/`RADIUS`/`LAYER` scales
and the SPLITIQ wordmark treatment from the sign-in screen. It has its own light/dark/auto
switch (OS preference by default, stored in `localStorage['splitiq.theme']`), applied as
`data-theme` on the tool root. One breakpoint: desktop grid at ≥ 761 px, phone stack below.

Two **additive** tokens serve it, in both palettes: `modelled` (a value the model
computed — the "Reference ideal — modelled" chip) and `measured` (a value a sensor
recorded — the importer, later). Both clear AA on `surface`, `raised` and `field`.
No existing value moved. Scene colours for the 3D view land with it (PR2).
`check:colours` also rejects three.js `0xRRGGBB` literals under `web/src/squat/`.

## Shared destinations, layouts suited to the screen

The 2026-11-13 vision amendment (#511/#515) supersedes the earlier platform split:
The target is **Today, Train, Progress and Body on both screen sizes**, with Settings as a
separate screen. Desktop retains its analytical layouts; it does not simply stretch
the mobile screens. Train includes the existing live erg and strength logger paths.
The previous rule that Train has no desktop counterpart no longer applies.

R37 and the R33 disposition were approved on 2026-11-15. R38 (#582) implements this
structure, retaining the existing analytical views as panes
and keeping Settings separately routed. Live erg and strength tools remain mounted
after their first visit so navigation preserves an active session.
The anatomy engine stays public and independently lazy-loaded. R22 owns the
exercise-to-anatomy link; the shell migration does not duplicate that work.

## The property boundary — the one hard rule

Three workstreams touch the same lines. They stay disjoint by *CSS property*, so they
can run in parallel without ever colliding:

| Workstream | Touches | Never touches |
|---|---|---|
| **#183** / the palette | colour hexes | any size |
| **S6** | `padding` `margin` `gap` `borderRadius` | any colour hex |
| **S-1 / TYPE** | `fontFamily` `fontSize` `fontWeight` `letterSpacing` `lineHeight` | colour hexes, box metrics |

Check your own diff before opening a PR. Keep this a human judgement — a moved line
legitimately shows both a colour and a padding, and a CI gate here would false-fail on
ordinary refactors.

## Which side owns what

`PROJECT-CONTEXT.md` sets the direction and it matters more than it looks:

| | Design project | This repo |
|---|---|---|
| The designs, `conventions.md`, `HANDOFF.md`, `ISSUES-load-states.md` | **source of truth** | mirror |
| Component source, hooks, maths, tests | — | **source of truth** |

**Do not hand-edit the mirrored files** — `conventions.md` above all. Edits are overwritten
on the next sync. Anything that has to reach a design session gets added on the project
side; anything that has to reach a code session gets committed here. Neither container can
see the other.

## The machine contract

`web/.design-sync/` is not just docs. `config.json` reads `entry.jsx`, `base.css`,
`docs/` and `conventions.md` **by path**, and `npm run check:design-sync` guards them in
CI. Do not move these files. A new shared component reaches the design system only if it
is added to `entry.jsx` *and* `componentSrcMap` *and* `dtsPropsFor` *and* given a
`docs/<Name>.md`.

Re-syncing the project to claude.ai/design needs an interactive `/design-login` and can
only be done from a local session — never from a remote agent container.

## Working on design

Design is a lane on the normal rail: **Issue → branch → PR → CI → `main`** (see
[`WORKFLOW.md`](WORKFLOW.md)). Label it `design`. A PR that changes what the app looks
like carries a screenshot or a baseline diff.
