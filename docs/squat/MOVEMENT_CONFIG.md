# Movement config: the squat

`web/src/movements/squat/movement.js` exports `SQUAT_MOVEMENT`: the squat as one
object (roadmap R12, #440). It gathers what the page and the 3D scene need to know
about the lift. It holds **references** to the modules in `web/src/squat/constants/`
and copies nothing, so each value still has exactly one source. Those modules stay
where they are until R21 folds them in.

Rules the tests hold it to (`web/src/movements/squat/__tests__/movement.test.js`):

- Plain data only: objects, arrays and primitives. No functions, no React, no logic.
- It imports from `squat/constants/` and nowhere else.
- The top level and every wrapper object it builds are frozen.
- `SquatApp.jsx` is its only consumer. The anatomy runtime (`web/src/anatomy/`) never
  imports it. A movement's data is handed in as an argument, which ESLint and
  `anatomy/__tests__/layering.test.js` both enforce.

## Fields

| Field         | Shape                                                             | Source                                                            | Read by                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `'squat'`                                                         | literal                                                           | (reserved for a second movement)                                                                                                                                     |
| `route`       | `{ path }`, `'/squat'`                                            | `constants/page.js` `ROUTE_PATH`                                  | test only. `RouteRoot` and `utils/squatRoute.js` keep their own literal so the dashboard's first paint never loads the tool's chunk. A test pins that the two agree. |
| `page`        | `{ title, description }`                                          | `constants/page.js`                                               | `SquatApp.jsx` (document title, meta description)                                                                                                                    |
| `dataAsset`   | `{ bin, manifest }`: file names, byte counts, sha256s             | `constants/dataAsset.js` `DATA_ASSET`                             | via its module today (`useAnatomyData`, the decode worker)                                                                                                           |
| `phases`      | the five phases: `index`, `id`, `name`, `heading`, `mode`, `goto` | `constants/phases.js` `PHASES`                                    | via its module today                                                                                                                                                 |
| `muscles`     | `{ regionNames, regionOf, synonyms }`                             | `constants/muscleRegions.js`, `constants/muscleSynonyms.js`       | via its modules today                                                                                                                                                |
| `activation`  | `{ bands, heatStops, topN }`                                      | `constants/activationBands.js` `ACT_BANDS`, `HEAT_STOPS`, `TOP_N` | via its module today                                                                                                                                                 |
| `guide`       | `{ panes, phasesIntro, phaseGuide, metricsIntro, measuredPane }`  | `constants/guide.js`                                              | via its module today                                                                                                                                                 |
| `formCheck`   | `{ label, items }`                                                | `constants/formCheck.js`                                          | via its module today                                                                                                                                                 |
| `metrics`     | the eighteen metric rows                                          | `constants/metricsTable.js` `METRICS_TABLE`                       | via its module today                                                                                                                                                 |
| `method`      | the "Method and limits" pane                                      | `constants/method.js` `METHOD`                                    | via its module today                                                                                                                                                 |
| `references`  | the fifteen cited sources                                         | `constants/references.js` `REFERENCES`                            | via its module today                                                                                                                                                 |
| `velocity`    | `[m/s, %1RM]` pairs, fastest first                                | `constants/velocityTable.js` `MV_TABLE`                           | the importer (PR4), not yet built                                                                                                                                    |
| `attribution` | third-party credit lines and URLs                                 | `constants/attribution.js` `ATTRIBUTION`                          | via its module today                                                                                                                                                 |
| `equipment`   | `{ bar }` (see below)                                             | `constants/barbell.js` `BARBELL`                                  | `SquatApp.jsx` → `useAnatomyScene` → `createAnatomyScene`                                                                                                            |

"Via its module today" means the components still import the constant directly.
The config makes the whole movement visible in one place now, and the readers move
onto it field by field in later slices.

## `equipment.bar`

What the scene builds the barbell from. All lengths are in metres.

| Key                            | Meaning                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `frame`                        | The pose frame the bar rides on (`'thorax'`)                  |
| `radius`                       | Shaft radius, used only when the manifest has no `meta.bar.r` |
| `length`                       | Shaft length, end to end                                      |
| `plateRadius`, `plateWidth`    | One plate's radius and thickness                              |
| `plateOffset`                  | Distance from the bar's centre to each plate                  |
| `sleeveRadius`, `sleeveLength` | Each sleeve's radius and length, flush with the shaft's end   |
| `segments`                     | Facets around every cylinder                                  |
| `metalness`, `roughness`       | The bar material                                              |

The manifest still owns two values, because the extraction measured them:
`meta.bar.c` is the bar's offset in the frame's rest space, and `meta.bar.r` is the
shaft radius (it wins over `radius`). The bar's colour is the `anatomyBar` palette
token, so it follows the theme.

`createAnatomyScene({ equipment })` takes `{ bar? } | null`:

- **No bar** (`null`, or no `bar`): the scene builds no cylinders and no bar material.
  The empty equipment group is still added, so the scene graph keeps its order.
- **A bar, but the manifest has no `meta.bar`**: the build throws
  `equipment.bar needs manifest meta.bar`. The scene tears down what it had built,
  and `useAnatomyScene` reports `errorKind: 'build'`.

## Out of scope

The config does not hold the share copy (`share.js`), the activation UI copy
(`ACT_NOTE`, `STALE_LINK` and the rest), or `contrastPairs.js`. Those are UI and
test data, not facts about the movement. Equipment lists, other implements, plate
load as data and the hard-coded `thorax` for the static muscle sets are R13 (#441).
Generalising phases is R14.
