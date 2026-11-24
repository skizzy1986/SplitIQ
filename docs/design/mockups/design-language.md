# SplitIQ design language: v10 everywhere

Draft for review, 25 November 2026. This is a short summary for the mockups in this folder. The detailed source is Live Session's `v10-design-tokens.md` (written up from the v10 prototype). Where the two disagree, that file and `web/src/constants/themeValues.js` / `tokens.js` win.

**Goal.** Every signed-in page should feel like the v10 live rowing session: dark, calm, numbers first, one obvious next action.

## Tokens

### Colour (DARK, via the `--color-*` seam)

| Token | Hex | Use |
|---|---|---|
| `--color-bg` | `#0d0e12` | Screen ground |
| `--color-surface` | `#16171d` | Cards |
| `--color-raised` | `#1e2027` | Controls, secondary buttons, chips, the active tab pill |
| `--color-border` | `#2a2d36` | Hairlines, outline buttons |
| `--color-text` | `#f3f4f6` | Body text |
| `--color-text-strong` | `#ffffff` | Figures and titles, the "on" state of segments and chips |
| `--color-muted` | `#a9adba` | Labels and secondary copy |
| `--color-text-faint` | `#8a8f9c` | Hints and planned rows |
| `--color-accent` | `#5cc8e8` | The one primary action per screen |
| `--color-on-accent` | `#06222c` | Ink on cyan. **Proposed new token**: white on cyan is 1.9:1, this is 8.6:1 |
| `--color-band-amber` / `--color-band-coral` | `#e8b45c` / `#e87a5c` | **Proposed new tokens**, for under-band and over-band chart bars and arrows only |
| `--color-neutral`, `--color-surface-deep` | `#4a4e5a`, `#090a0e` | Empty bars, the PM5 LCD mimic |

Rules:

- **One cyan per screen.** The cyan goes on the primary action. A screen with no primary action can have none. Selected tabs, segments and chips are shown by inverting them (white fill, dark ink) or with a raised pill, never in cyan.
- **Colour is never the only signal.** Use a solid dot for a connected PM5 and a hollow one for not connected. Session rows carry an `ERG` / `STR` text tag. Bands pair the colour with a word and an arrow (`▼ 18 W under band`), and band charts carry a caption.
- **Errors stay neutral.** Use plain copy on a raised card, not red.
- **No new zone tables.** Watt ranges always come from `derivePaceZones(cp)` and are never typed into a page or a doc.

### Type

- **Fonts.** Archivo is for words, and IBM Plex Mono with `tabular-nums` is for every measurement: watts, /500m, time, metres, spm, HR, dates in tables.
- **Weights.** 500 to 700 only, never 800.
- **Size ladder on dashboard pages** (Today, Train list, Progress, Body, Settings): 52 hero, 32 page title, 20 title and tile figures, 14 body, 11/700 uppercase labels, 9 floor.
- **Live screens** (Ready, live, rest, summary, builder) can keep v10's larger heroes (56, and 124 for the rest countdown), 12 px labels and 15–17 px body.

### Space, radius, layers, touch

- **Spacing.** 4 px scale (2, 4, 8, 12, 16, 24, 32). Gutters are 16. Don't use 6, 10 or 14 on dashboard pages.
- **Radius.** Dashboard cards 12, live-erg cards and buttons 16, sheet top corners 24, pills 999.
- **Elevation.** Raise with fill (`raised`), not shadows. The sticky action bar fades out of `bg`.
- **Layers.** Use the repo's `LAYER` values, for example sheet 200 and backdrop 150.
- **Touch.** At least 44 × 44. Primary button 56 tall (72 for the home hero start), header 56, tab bar 72.

## Components

| Component | Spec |
|---|---|
| Top bar | 56 tall. Wordmark or Back on the left, PM5 pill and Settings gear on the right. |
| PM5 pill | Raised capsule. A solid dot and the serial when connected. A hollow dot and "last used Mon" or "not connected" otherwise. |
| Card | Surface fill, radius 12 on dashboard pages (16 live), padding 16, 12 gap below. |
| Section header | 11/700 uppercase muted label, with an optional "History ›" link on the right. |
| Primary button | Cyan with on-accent ink, 56 tall (72 for the hero start). One per screen. |
| Secondary / outline / ghost | Raised fill / 1.5 px border / text only. |
| Start row | 84 tall, icon tile, 18 title, mono facts line with watts first. The first one can be the screen's primary. |
| Segmented control | Surface track, inverted white "on" segment. Used for the Progress panes, the Train picker, Time/Distance/Intervals, and Theme/Language. |
| Chips | 44 tall, raised, inverted when on. |
| List row | 56 min height: type tag, title, mono meta, right-aligned watts and an sRPE tag, then a chevron. One row style is shared by Today's Recent, History and Next planned. |
| Stat tiles | 2–4 across. Uppercase key, mono value. |
| Readiness strip | One line on Today: readiness score and status, form and band word. Taps through to Body. |
| Split ladder | The v10 `table.st` with the All row on top. Shared by the live screen, summary and session page. |
| Watts per split | v10 bars. Cyan for in band with an amber or coral arrow mark off band, and always a caption. Neutral bars where another cyan is already the accent. |
| Sheet | Bottom sheet with 24 px top corners and a grab handle, over a 66% black backdrop. Used for the Row start sheet and Wake the PM5. |
| Tab bar | Today, Train, Progress, Body. The active tab has a raised pill and strong ink. The bar hides during a live session. Option C adds a raised cyan Row button in the middle. |
| Toggle | 52 × 32, knob position plus track contrast. |
| sRPE picker | Ten mono buttons 1–10, inverted when chosen. |

## Copy

- Australian English and erg terms: interval (not rep), spm, /500m, watts first.
- Dry wit by default in pitches and cues. The app describes and never grades: no "great job", no coach.
- Every number is derived, never typed. In the mockups, all numbers are example data.
