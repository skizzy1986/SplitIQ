# Where project material lives

Git holds code, docs and small derived data. Everything else lives in one of the two
places below. Each entry records a sha256 where one exists, so a copy can be checked.

| What | Where | Why not git |
|---|---|---|
| Code, docs, the `/squat` anatomy data (~2.2 MB), the squat-anatomy pipeline and its cached stage outputs | This repo | — |
| Original squat-anatomy exports (`squat-anatomy-v3.zip`, `squat-anatomy-preserve.zip`) | GitHub Release `squat-anatomy-archive-2026-11-04`, mirrored in Drive `SplitIQ/archives/` | ~19 MB of unmodified originals, kept for provenance. Hashes are in [`pipeline/squat-anatomy/ARCHIVE.md`](../pipeline/squat-anatomy/ARCHIVE.md). |
| Voice-cue clips (782 mp3, about 15 MiB: three voices plus tones, built by SplitIQ Sound) | GitHub Release `voice-cues-v1` (`voice-cues-v1.tar.gz` and `SHA256SUMS`), fetched into `web/public/audio/cues/` by `web/scripts/fetch-voice-cues.mjs` before every build and checked against the SHA-256 in `web/scripts/voice-cues.json` and `web/scripts/voice-cues.sha256`. Only the 20 KB `cues.index.json` is in git. A new bank is a new tag (`voice-cues-v2`), never a replaced asset. | 15 MiB of mp3 stays in git history forever, and every re-render adds another copy. Public repo, so the fetch needs no secret. |
| BodyParts3D STLs | Fetched on demand by `pipeline/squat-anatomy/scripts/fetch_stl.sh` | Public upstream; refetching gives byte-identical files. |
| OpenCap / SimTK lab-validation data | Scott's Google Drive, `SplitIQ/datasets/opencap-labvalidation/` (with a `SOURCE.md`) | Licence not verified ([`docs/squat/LAB_DATA.md`](squat/LAB_DATA.md)). **Never commit it.** |
| Session handoff prompts, research notes, renders and screenshots | Scott's Google Drive, `SplitIQ/` (`handoffs/`, `research/`, `media/`) | Working material, not source. |
| Claude skills, agents and doctrine; the roadmap and planning history | Private repo `skizzy1986/SplitIQ-ops`, delivered as claude.ai account skills (zips in Drive `SplitIQ/skills/`) | Not app source. Account skills are the only private layer that reaches cloud sessions as well as the local CLI (#674). |
| Backups of this repo and SplitIQ-ops | Scott's Google Drive, `SplitIQ/backups/` (daily git bundles) | Copies, not source. |

## The Drive hub (`My Drive/SplitIQ`)

Scott owns it; collaborators don't have access unless he shares a folder. Its
`00-README.md` lists the folders and their rules:

- `archives/` — originals, never edited, with a sha256 recorded.
- `handoffs/` — named `YYYY-MM topic`, marked `(CURRENT)` or `(SUPERSEDED)`.
- `datasets/` — one folder per dataset, each with a `SOURCE.md` giving its origin and licence.
- `research/`, `media/`.
- `skills/` — built skill zips and `MANIFEST.md`; generated, never edited.
- `backups/` — daily bundles, 14 daily and 12 monthly kept; `git clone <bundle>` restores.

When you add something there that the code depends on, add a row to the table above.
