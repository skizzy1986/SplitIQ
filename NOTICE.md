# Third-party notices

The code in this repository is proprietary and covered by the root
[`LICENSE`](LICENSE), plus any written permissions recorded in
[`PERMISSIONS.md`](PERMISSIONS.md). The files below are not: they are third-party
material, or derived from it, and carry their own terms. Those terms apply whatever
`PERMISSIONS.md` allows.

## BodyParts3D — CC BY-SA 2.1 JP

- `web/src/squat/assets/squat-anatomy.bin`
- `web/src/squat/assets/squat-manifest.json`

Anatomical geometry derived from **BodyParts3D**, © The Database Center for
Life Science (DBCLS), <https://lifesciencedb.jp/bp3d/>, licensed under
[CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en).
The derived data in these two files is shared under the same licence; see
`web/src/squat/assets/LICENSE.md`. The squat tool credits BodyParts3D on every
screen that can show the anatomy.

The same applies to the pipeline that generates them, `pipeline/squat-anatomy/`.
Its geometry-bearing stage outputs (`pipeline/v3/base.html`, `*.npy`, `*.npz`, `*.pkl`)
are BodyParts3D-derived and shared under CC BY-SA 2.1 JP. The source BodyParts3D STLs
aren't committed; `scripts/fetch_stl.sh` fetches them from the public BodyParts3D
repository. The pipeline's own code is covered by the root `LICENSE`.

## OpenSim musculoskeletal models

The squat model's leg-muscle paths follow these published models. No model
file (`.osim`) or geometry from them is redistributed here; their paths were
used, in the separate source project, to shape the muscle curves inside the
BodyParts3D-derived data above.

| Model | Citation | Distributed by | Terms (verified 2026-11-04) |
|---|---|---|---|
| Full-body model | Rajagopal A, et al. (2016). Full-body musculoskeletal model for muscle-driven simulation of human gait. *IEEE Trans Biomed Eng*. | SimTK project `full_body` | "MIT Use Agreement" — <https://simtk.org/frs/?group_id=773> |
| Deep-flexion update | Lai AKM, Arnold AS, Wakeling JM (2017). Why are antagonist muscles co-activated in my simulation? *Ann Biomed Eng*. | SimTK project `model-high-flex` | "MIT Use Agreement" — <https://simtk.org/frs/?group_id=1302> |
| OpenCap model | Uhlrich SD, et al. (2022) model, as shipped with OpenCap | `stanfordnmbl/opencap-core` | Apache-2.0 — <https://github.com/stanfordnmbl/opencap-core> |

How the terms above were verified, and what was not:

- **SimTK "MIT Use Agreement" (Rajagopal 2016, Lai 2017).** The label was read on each
  project's SimTK download page (the `frs` links above), where SimTK shows the licence a
  download is offered under. The full text of the agreement itself — normally shown in a
  click-through at download time — was **not** read, so its exact conditions beyond
  that label are unconfirmed.
- **Uhlrich 2022 via `opencap-core`.** The Apache-2.0 entry is the licence of the
  `stanfordnmbl/opencap-core` repository. That this repository is the route by which the
  source project obtained the Uhlrich 2022 model is **unconfirmed** — the model is also
  distributed elsewhere, and the source project does not say which copy it used. If it
  came another way, that route's terms apply instead.

The `opensim-org/opensim-models` repository, which the source project names as
its route to these models, states no licence of its own; the terms above are
those of each model's distributing project. Each asks that the model's paper be
cited, which the tool does in its Sources list.

## Published reference values

Numbers used as targets and reference ranges are facts reported in the cited
papers, listed with citations in `docs/squat/REFERENCES.md` and in the tool's
Sources pane.

## free-exercise-db — The Unlicense (public domain)

- `supabase/seed/free-exercise-db/exercises.json` (verbatim upstream file)
- `supabase/seed/exercises.sql` (generated from it by
  `web/scripts/generate-exercise-seed.mjs`)
- the 873 rows of the production `exercises` table, which those files reproduce

The exercise catalogue comes from **free-exercise-db**,
<https://github.com/yuhonas/free-exercise-db>, at commit
`5197c055b356498944328bd00178b64a5e9f422c` (2024-01-16), file
`dist/exercises.json` (git blob `99d414913b62e96263f31d1babe5bb50d13444f5`).
Upstream's README says it restructured the data from
[`wrkout/exercises.json`](https://github.com/wrkout/exercises.json).

Licensed under [The Unlicense](https://unlicense.org/), from the upstream
`LICENSE.md` at that commit; `wrkout/exercises.json` is also Unlicense (GitHub
licence API). It is a public-domain dedication and requires no attribution; it is
credited here as provenance.

The exercise images are **not** redistributed here: `web/src/StrengthLogger.jsx`
loads them from `cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/`.

How this was verified, and what was not (2026-11-15):

- **Verified:** the committed JSON is byte-identical to the upstream file at the
  pinned commit (its git blob sha is checked by a test), and the 873 production
  rows match it: an md5 fingerprint over all 11 data columns, read from
  production, equals the one computed from the file
  (`149ed35cc65128b5ee354a997d7fdd79`).
- **Verified:** the repository-level licence, from `LICENSE.md` at the pinned
  commit.
- **Not established:** the provenance of the images and of the individual
  instruction texts beyond the repository's licence file.
