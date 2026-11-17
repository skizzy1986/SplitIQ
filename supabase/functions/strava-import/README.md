# strava-import (#54)

Imports Strava activities into `public.sessions`, and — more importantly —
**adopts** the sessions that are already there under a different `source`.

Four functions ship together:

| Function | JWT | Purpose |
|---|---|---|
| `strava-connect` | **verified** (default) | Mints the OAuth `state`, returns the authorize URL; also disconnects |
| `strava-oauth-callback` | **`--no-verify-jwt`** | Strava's redirect target. Always 302, never a body |
| `strava-import` | **`--no-verify-jwt`** + `x-cron-secret` | The scheduled run |
| `strava-sync` | **verified** (default) | The Sync button. Same `runImport` as the cron |

The pure logic lives in `mapper.ts` (what an activity becomes), `state.ts`
(cursors and budgets), `tokens.ts` (refresh-token rotation) and `client.ts`
(all Strava HTTP). `importer.ts` is the only orchestration, shared by both entry
points, so a manual sync and a scheduled one cannot drift apart. `supaClient.ts`
holds `serviceClient` and is the one file that value-imports supabase-js — see
**Tests** for why that split is load-bearing.

## Why adoption is the whole feature

Around twenty sessions in `public.sessions` are the **same training** as a
Strava activity, filed by hand or by Coach under `source` = `portal`, `coach`,
`coach_plan`, `claude_csv` or `concept2`. Importing those again would **double
ten weeks of CTL, ATL and TSB** — the app's central numbers — with no error
anywhere to notice it.

For every eligible activity not already linked, `chooseAdoptionCandidate` looks
for an existing unlinked session in the same type family, within ±1 day, whose
`distance_m` agrees:

- **exactly one** match → `adopt_strava_session` (links the existing row, writes
  only `strava_activity_id`, device `avg_watts` and `avg_hr` — never
  `coach_note`, `duration`, `label`, `date` or `source` — and records an
  `adopted` provenance row holding the values it replaced)
- **zero** matches → `upsert_strava_session` (a new row, with an `inserted`
  provenance row)
- **two or more** → **nothing at all.** The activity id is appended to
  `strava_sync_state.ambiguous_activity_ids`, `skipped_total` increments, and
  Sentry gets one issue for the run. A wrong adoption silently rewrites power
  onto a session that was not that session; a visible unresolved item does not.

Tolerances come from real pairs: `±max(5 m, 0.5%)` (the same training filed
twice sat 2 m and 5.2 m apart on ~10–14 km pieces) and a ±1-day window (some
rows are filed a day off the activity's local date).

### An adopted row keeps its own duration and distance, for ever

`adopt_strava_session` deliberately does not touch `duration` or `distance_m`.
That promise only holds because `upsert_strava_session` honours it too: once a
row is linked, **every later run reaches it through `upsert_strava_session`**,
so an unguarded `DO UPDATE` there would undo the adoption's restraint one cron
cycle later — `60min` → `60:00`, `9998` → `10000`, and `9min` → `8:49`, which
changes the parsed duration from 9.0 to 8.82 minutes and therefore the load.

The discriminator is the **`origin` of the row's `strava_session_links` entry**,
not `sessions.source`. `source = 'strava'` does not mean "this importer inserted
it": six legacy rows carry it from a hand import, and once adopted they must
keep their hand-filed duration and distance. So:

| link `origin` | `duration`, `distance_m` | `avg_watts`, `avg_hr` |
|---|---|---|
| `inserted` (this importer created the row) | refreshed each run | enriched (coalesce) |
| `adopted` (the athlete filed it), whatever its `source` | **never touched** | enriched (coalesce) |

A linked session with no link row is refused outright: the RPC raises rather
than guess whether its duration may be rewritten.

**`avg_watts` and `avg_hr` are not protected the same way.** On an adopted row,
every later re-listing of the activity writes Strava's values over them again
(when Strava has a value). A correction the athlete types into either field
after adoption is therefore **not preserved**: the next run that sees the
activity replaces it. `prior_*` does not help there either — it is captured
once, on the importer's first write, so it holds what the athlete had *before
adoption*, not a later edit.

### Provenance: `strava_session_links`

Every write the importer makes records what it did, so a later deletion (#630:
disconnect, revocation purge, deletion sync) can remove exactly that and
restore what the athlete had typed.

| column | meaning |
|---|---|
| `session_id` | PK, FK → `sessions.id` `ON DELETE CASCADE` |
| `user_id`, `strava_activity_id` | `UNIQUE (user_id, strava_activity_id)` |
| `origin` | `inserted` (delete the row) or `adopted` (keep the row, strip what was written) |
| `wrote_avg_watts`, `prior_avg_watts` | whether the importer wrote `avg_watts`, and what was there before |
| `wrote_avg_hr`, `prior_avg_hr` | the same for `avg_hr` |
| `device_name` | the recording device, so Garmin rows can be found when attribution ships (#632) |
| `created_at` | when the link was made |

`wrote_*` flips and `prior_*` is captured on the **first** write of each column
only. A later re-import that enriches the row again never touches `prior_*`, so
the athlete's original figure cannot be replaced by an earlier Strava one. On an
`inserted` row `prior_*` is always null — there was nothing underneath.

Both RPCs are race-safe. Two runs inserting the same activity: the second
blocks on 011's partial unique index, catches the `unique_violation` in a
subtransaction and retries as an update — one row, no error. Two runs adopting
the same row: the candidate is read `FOR UPDATE` with `strava_activity_id IS
NULL`, so the second finds it claimed and returns `adopt_lost_race`. Migration
012 self-tests both RPCs against synthetic rows inside a subtransaction that is
always rolled back.

**How a deletion uses it (#630, migration 019).** Per link: an `inserted` row
with no athlete data (no sRPE; blank note, coach flag and benchmark key; `prs`
0 or null; `exercises` null, `[]` or `{}`) is **deleted**. An `inserted` row the
athlete has since annotated is **kept**: `avg_watts` / `avg_hr` go back to
`prior_*` where `wrote_*` (null on an inserted row, so Strava's figures are
stripped), `strava_activity_id` is cleared and the link deleted. An `adopted`
row gets the same restore + unlink. Date, label, type, duration, distance,
status, source and every athlete field are never touched. A session carrying a
Strava id with no link (an orphan) is unlinked with its figures left alone —
there is no record of what was written to it. Both RPCs also take the
athlete's sync row `FOR SHARE` before writing and raise `P0003` if it is gone or
disconnected, so an import in flight cannot write a link after a purge commits.

## Eligibility

All five must hold. `sport_type` is an **allow-list**, never a deny-list, and is
matched exactly — `"ride"` and `"Ride "` are not `Ride`.

| Rule | Value |
|---|---|
| `sport_type` | `Rowing`, `VirtualRow` → `type='erg'`; `Ride`, `VirtualRide`, `GravelRide`, `MountainBikeRide`, `EBikeRide`, `EMountainBikeRide` → `type='cycling'` |
| local date | `>= STRAVA_BACKFILL_FROM` (`2026-06-14`) |
| `moving_time` | `>= 120 s` |
| `distance` | `>= 200 m` |
| `device_name` | not a Garmin (see below) |

Everything else is ineligible, including `Handcycle`, `Velomobile`, `Walk`,
`Run`, `Hike`, `Workout`, `WeightTraining`, `Yoga` and `NordicSki`.

The floors keep the 240 s / 1080 m `CP Test` while dropping the 4 s / 16 s /
23 s / 72 s and 9 m / 40 m / 53 m / 155 m fragments a bumped PM5 records.

### Garmin-recorded activities are skipped

Strava's API Policy §4.4 requires Garmin attribution on data from a Garmin
device, and the app does not show it yet (#632). Until it does, an activity
whose `device_name` matches `/garmin/i` is **not imported**, whatever its sport,
with skip reason `garmin_attribution_pending`. The skip shows in a dry run like
any other, and the watermark moves past it like any other ineligible activity.

**Where the device name comes from.** Strava documents `device_name` ("The name
of the device used to record the activity") on `DetailedActivity` only (Context7,
`/websites/developers_strava`). Its sample `GET /athlete/activities` response
does carry it, but a sample is not a contract, so a summary's `device_name` is
treated as unreliable:

- a summary that **names a Garmin** is skipped there and then, with **no detail
  fetch**;
- a summary that **names no device** (`null` or missing) gets a detail fetch —
  even when it already carries power and heart rate — and the Garmin check runs
  again on the detail **before any write**. If the detail names no device
  either, the activity is not Garmin and imports as before;
- a summary that names a non-Garmin device follows the normal detail-fetch rules;
- an ineligible sport, or an activity the summary already proves ineligible on
  date or the floors, still costs no read.

If the detail cannot be fetched (budget spent, quota near its cap, a 429 or an
error) the activity is deferred under the usual rules — never written unchecked.

The read-budget cost is small in practice: list payloads rarely carry both watts
and heart rate, so nearly every eligible activity is detail-fetched already (see
below). The extra reads fall only on a summary that has both but names no
device.

## Mapping contract

| column | value |
|---|---|
| `date` | first 10 chars of `start_date_local`, reformatted to unpadded `M/D/YY`. **Never `new Date(...)`** — Deno runs in UTC and a timezone-less local string would shift the day for every evening session |
| `type` | `'erg'` / `'cycling'`, lower case (what `normType()` in `web/src/utils/formatting.js` recognises) |
| `label` | `` `<name> HH:MM` ``, ≤120 chars. **Never contains a watts figure** — that is what breaks dedupe today |
| `duration` | `m:ss` from `moving_time` (1500 → `25:00`, 2465 → `41:05`) |
| `distance_m` | `Math.round(distance)` |
| `avg_watts` | only when Strava reports device watts; **never a pace- or speed-derived estimate**. Almost always comes from the detail fetch, not the list payload — see below. A ride with no power meter is written with null |
| `avg_hr` | only when `has_heartrate`. Same |
| `status` / `source` | `'completed'` / `'strava'` |
| `srpe`, `coach_note`, `prs`, `exercises`, `coach_flag`, `benchmark_key` | **never written** |

## The per-activity detail fetch is the normal path, not an exception

Strava's **SummaryActivity** — what `GET /athlete/activities` returns — **does
not reliably carry power or heart rate.** `average_watts` is documented
rides-only and `has_device_watts` is a `DetailedActivity` field. Verified against
a real rowing activity: its list payload carried `distance`, `moving_time`,
`average_speed`, `total_calories` and `average_cadence` and **no watts and no
heart rate**, while `GET /activities/:id` for the same activity returned
`average_watts`, `average_heartrate` and `has_device_watts: true`.

An importer that only fetched detail for a summary missing `distance` /
`moving_time` / `start_date_local` would therefore write `avg_watts` and `avg_hr`
as **null on essentially every row**. `sessionLoad()` in
`web/src/utils/trainingLoad.js` scores such a session **0**, so the feature would
import sessions contributing nothing at all to CTL/ATL/TSB — silently, and the
exact opposite of its purpose. The 50-call budget exists to pay for these
fetches.

`needsDetailFetch()` in `mapper.ts` is the gate. It answers true for an eligible
sport whose summary lacks usable device watts **or** heart rate (or lacks the
core mapping fields), and false for everything else — including sports we do not
import, because a read spent on a `Walk` is a read taken from a row that counts.
An activity the summary already proves ineligible (too short, before
`STRAVA_BACKFILL_FROM`, recorded on a Garmin) costs no read either.

**A ride with no power meter is still imported.** When the detail fetch succeeds
and Strava says the power was not measured (`device_watts: false`), the row is
**written** with `avg_watts` null and `avg_hr` set. It is not deferred — the
detail was read, and there is no power to wait for. Such a session scores zero
load in `sessionLoad()` until the athlete adds an sRPE (owner decision on #628);
a heart-rate load fallback is #633.

### What happens when the detail cannot be fetched

Budget spent, quota nearly spent, or the fetch itself failed: the activity is
**deferred, not written**. This is the load-bearing half. A row written with a
null `avg_watts` is indistinguishable from a genuine no-power session, and the
cursor would move past it, so the power would be lost silently and permanently.

Deferring instead holds the cursor that re-lists it — `incremental_after` is
clamped below the activity for something the incremental pass found,
`backfill_cursor_before` is clamped above it (and `backfill_complete` cleared)
for something the backfill found — and the chunk ends cleanly for the next run
to pick up. `ImportResult.deferred` counts them, and each gets a decision with
`action: "skip"` and `detail: "deferred:<why>"`. **No `*_total` counter
accumulates a deferral**: it is a property of one chunk, not a verdict on the
activity.

## Required secrets

Supabase dashboard → Edge Functions → Secrets.

| Secret | Purpose |
|---|---|
| `STRAVA_CLIENT_ID` | Strava API application id |
| `STRAVA_CLIENT_SECRET` | Strava API application secret |
| `STRAVA_OAUTH_CALLBACK_URL` | The public URL of `strava-oauth-callback`. Must match the **Authorization Callback Domain** registered on the Strava app, and is the `redirect_uri` sent to Strava |
| `STRAVA_APP_REDIRECT_URL` | Where the callback 302s the browser afterwards, e.g. `https://erg-dashboard-eight.vercel.app/`. Always this value, never anything from the request |
| `STRAVA_BACKFILL_FROM` | `2026-06-14` (Scott's Gate 2 decision) |
| `STRAVA_CRON_SECRET` | `x-cron-secret` for `strava-import`. **Distinct from the vitals `CRON_SECRET`** so a leak of one cannot be replayed against the other |
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected. Bypasses RLS; the only role granted EXECUTE on the two RPCs |
| `SENTRY_DSN` | Shared with the other functions; without it every Sentry export is a no-op |

There is **no `STRAVA_OAUTH_STATE_SECRET`**. The `state` is a plain opaque
32-byte random token with nothing embedded and no HMAC — the
`strava_oauth_state` row is what makes it single-use *and* what binds it to a
user, so a signature would add a second mechanism providing no property the row
does not already provide.

**Never logged, never sent to Sentry:** `access_token`, `refresh_token`,
`client_secret`, the `state`, the `code`. Sentry context carries ids, counts and
status codes only — the fingerprint is the error message, so a message must
never carry token material.

## Deploy

Apply the migrations first, in one sitting, with the owner's approval: `011`,
then `012`, then `018` (which keeps the `strava_*` tables out of the nightly
backup — until it runs, `backup_snapshot()` would export the OAuth tokens), then
`019` (`019_strava_purge`: the disconnect, revocation-purge and deletion-sync
functions — see **Deletion**), all **before any OAuth grant**. Then:

```bash
# JWT verification ON — do NOT pass --no-verify-jwt to these two
supabase functions deploy strava-connect
supabase functions deploy strava-sync

# public: Strava's browser redirect carries no JWT
supabase functions deploy strava-oauth-callback --no-verify-jwt

# public: pg_cron carries no JWT; the x-cron-secret guard is the only gate
supabase functions deploy strava-import --no-verify-jwt
```

Getting the last two wrong in either direction is silent: deploy the callback
with JWT on and every connect dies at the redirect with a 401 the user never
sees the cause of; deploy `strava-import` with JWT on and the cron 401s nightly.

## Cron registration

Every 15 minutes, aligned with Strava's short rate-limit window. Replace the
placeholder with the real `STRAVA_CRON_SECRET` before running; do not commit it.

```sql
select cron.schedule(
  'strava-import',
  '*/15 * * * *',
  $$
    select net.http_post(
      url     := 'https://swdrueaserjzhuxnzmeu.supabase.co/functions/v1/strava-import',
      headers := '{"Content-Type":"application/json","x-cron-secret":"<STRAVA_CRON_SECRET>"}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);
```

To stop it: `select cron.unschedule('strava-import');`

A run that hits HTTP 429 sets `strava_sync_state.rate_limit_resets_at` to the
next quarter hour — or to the next midnight UTC when the daily cap is the cause
(see **Backfill, incremental and throttling**) — and every run before that
returns immediately, which is what stops one 429 becoming ninety-six a day.

This one cron entry also carries both deletion paths (#630) — there is **no
second cron**. Each athlete's run ends with the deletion sync when it is due
(at most every 12 hours per athlete, an hour after an aborted pass), and every
invocation then runs the revocation purge for athletes past their deadline.
See **Deletion**.

## Dry run — and the legacy-6 verification

**Do this before the first real import.** `dry_run` runs the entire pipeline and
reports the per-activity decision with **zero writes**, including no sync-state
update, so inspecting the plan cannot change what the next real run does.

**Who runs it.** The dry run, and every read-back below that returns Strava
data, is run and read by the owner — not by an AI agent. Strava's API Policy
§5.3 forbids Strava Data being read into an AI application's context window.

**Do not press Sync after connecting until this gate has passed.** Sync performs
a **real** import and bypasses the gate entirely.

**The gate is iterative.** A run is capped at 50 Strava calls, so one dry run
cannot show a whole backfill: it shows the first chunk, and everything past the
budget appears as `deferred:`. So:

1. dry run, and check the decisions below;
2. the owner approves;
3. one real run, at least 15 minutes after the dry run (so the 15-minute quota
   has reset);
4. dry run again — it now shows the next chunk;

and repeat until a dry run reports nothing deferred. Only then register the
cron.

```bash
# cron entry point
curl -sS -X POST 'https://swdrueaserjzhuxnzmeu.supabase.co/functions/v1/strava-import?dry_run=1' \
  -H 'x-cron-secret: <STRAVA_CRON_SECRET>' | jq '.results[0]'

# user entry point (browser session JWT)
curl -sS -X POST 'https://swdrueaserjzhuxnzmeu.supabase.co/functions/v1/strava-sync' \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"dry_run":true}' | jq
```

Each entry in `.decisions` is `{ activityId, sportType, date, action, detail }`
where `action` is `insert`, `adopt` (detail = the session id), `update`, `skip`
(detail = the reason, e.g. `sport_type`, `moving_time`,
`garmin_attribution_pending`) or `ambiguous` (detail = the tied session ids). A
`skip` whose detail starts `deferred:` is **not** a decision about the activity —
the run could not fetch its detail and the next run will process it.

A dry run makes **zero writes of any kind**, and that explicitly includes the
token row: `getFreshAccessToken` deletes it on a second consecutive
`invalid_grant`, and `runImport` suppresses that deletion under `dry_run`. Token
*rotation* still happens — listing anything needs a live access token, and
Strava rotates the refresh token whenever it issues one — but a dry run can
never disconnect the integration.

**The check that matters.** List the legacy sessions that a Strava activity
should adopt rather than duplicate:

```sql
select id, date, date_iso, type, label, distance_m, source
  from public.sessions
 where user_id = '<uuid>'
   and strava_activity_id is null
   and status in ('actual','completed','logged')
   and date_iso >= '2026-06-14'
   and distance_m is not null
   and (type ilike '%erg%' or type ilike '%row%' or lower(type) = 'z2 aerobic'
        or type ilike '%cycl%' or type ilike '%bike%' or type ilike '%ride%')
 order by date_iso;
```

Then, in the dry-run output:

1. **Every** one of those rows must appear as the `detail` of an `adopt`
   decision. A legacy row that does not appear will be **duplicated** by the
   real run — that is the doubled-CTL failure, and the dry run is the only place
   it is cheap to catch.
2. No session id may appear as the `detail` of two different `adopt` decisions.
3. Anything reported `ambiguous` needs a human decision before the real run:
   inspect the tied ids, delete or relabel the wrong one, then re-run the dry
   run and confirm it has become an `adopt`.
4. `insert` decisions should be activities with no counterpart in the table at
   all. Spot-check a few dates against the Log.

Only when 1–3 hold, and the iterative gate above has reached a dry run with
nothing deferred, should the cron be registered.

After the first real run (owner-run — these return Strava-derived data):

```sql
select last_run_at, last_run_status, last_error_code, imported_total, adopted_total,
       skipped_total, failed_total, ambiguous_activity_ids, backfill_complete,
       backfill_cursor_before, incremental_after
  from public.strava_sync_state;

-- must return zero rows: one activity can only ever be on one session
select strava_activity_id, count(*) from public.sessions
 where strava_activity_id is not null group by 1 having count(*) > 1;
```

**Deletion dry runs and read-backs (#630)** — owner-run, like everything in
this section: each returns Strava-derived data.

The same `dry_run` call also shows both deletion paths, with zero writes. The
deletion sync ignores its due time under `dry_run`, so it always runs (when the
import itself finished cleanly with the backfill complete); the revocation
purge lists what it would do for every athlete past the deadline:

```bash
curl -sS -X POST 'https://swdrueaserjzhuxnzmeu.supabase.co/functions/v1/strava-import?dry_run=1' \
  -H 'x-cron-secret: <STRAVA_CRON_SECRET>' | jq '{reconcile: .results[0].reconcile, revocation}'
```

`reconcile.decisions` (dry run only) lists each candidate as `keep_present`
(still on Strava), `delete`, `keep_unlink` or `restore_unlink`. Before the
first real pass, check every `delete` against Strava by hand: it must be an
activity really deleted there. `revocation` entries are `would_purge` with
counts, or `not_due` / `no_state` / `reconnected`.

What a disconnect would do, from the dashboard's own call (no write):

```bash
curl -sS -X POST 'https://swdrueaserjzhuxnzmeu.supabase.co/functions/v1/strava-connect' \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"action":"disconnect_preview"}' | jq
```

After a real disconnect or revocation purge, all four must return zero:

```sql
select count(*) from public.strava_session_links where user_id = '<uuid>';
select count(*) from public.sessions where user_id = '<uuid>' and strava_activity_id is not null;
select count(*) from public.strava_sync_state where user_id = '<uuid>';
select count(*) from public.strava_tokens where user_id = '<uuid>';
```

and the kept and restored rows read back with the athlete's own sRPE, notes
and (for adopted rows) original `avg_watts` / `avg_hr`, spot-checked in the
Log against the preview's counts.

## Backfill, incremental and throttling

- **Incremental** lists `?after=<incremental_after>`, paging until exhausted.
  **`after` is held fixed for the whole paging loop and only `page` moves.**
  Advancing both together double-advances — page 2 gets requested against a set
  that already excludes page 1's activities, so the block in between is never
  listed, and the watermark has moved past it so it is never listed again.
  The watermark advances over **everything seen, ineligible activities
  included** — otherwise a week of nothing but `WeightTraining` is re-listed for
  ever — but **only when the loop ran to exhaustion**: a loop cut short by the
  budget has seen an unknown subset of the window. Re-listing is free (the
  upsert is idempotent); skipping is permanent.
- **Backfill** walks *backwards* via `?before=<backfill_cursor_before>`, at a
  fixed `page=1` with the cursor moving. The cursor is persisted **once, at the
  end of the run, in the same write as the rows it describes** — never mid-walk.
  Collection and writing are separate phases, so a cursor written mid-walk would
  describe rows that do not exist yet, and a run killed in between would lose
  them permanently (they sit below `incremental_after`, so nothing re-lists
  them). Without the mid-walk write an interrupted run simply re-walks from the
  last durable cursor, which is idempotent and costs one repeated page.
  `backfill_complete` is set when a page returns an activity older than
  `STRAVA_BACKFILL_FROM`, comes back short, or is empty.
- **Budget:** 50 Strava calls (list *and* detail) and 20 s of wall clock per
  invocation, and the run stops at **80% of either Strava window, read from the
  response headers** (`X-RateLimit-Limit` / `X-RateLimit-Usage`, preferring the
  `X-ReadRateLimit-*` pair; each is a `15-minute,daily` pair). The app's read
  limits are 100 per 15 minutes and 1,000 per day (overall 200 and 2,000), but
  the code only ever uses the figures in the headers. The remaining 20% is
  headroom for a manual sync — spending the quota to the last call would make
  *that* fail.
- **Daily cap.** At 80% of the daily read limit the run stops with
  `stopReason: "daily_rate_limit"`, defers whatever it had not fetched, and
  sets `rate_limit_resets_at` to the **next midnight UTC** — Strava: "The daily
  limit resets at midnight UTC" (developers.strava.com/docs/rate-limits). A 429
  whose headers show the daily usage at its limit holds until midnight UTC too;
  any other 429 holds until the next quarter hour, as before. A response with no
  daily figures behaves exactly as before. When the daily cap and another stop
  condition (call budget, wall clock, the 15-minute window) are true together,
  the daily cap is the reason recorded, and once recorded no later stop in the
  same run replaces it — otherwise the midnight hold would be lost.
  **What the athlete sees:** the run that stops at the daily cap still ends
  `ok` (or `noop` if it had nothing to write), but every later run — cron or Sync — returns
  `rate_limited` until the hold expires at midnight UTC, even though no 429
  occurred. That is intended: it is the hold doing its job.
- **Per-activity `try/catch`:** one failure increments `failed_total`, reports to
  Sentry and continues. A run failing 2 of 14 ends `partial` with 12 rows
  correctly written. A failed *write* does **not** hold the cursor, on purpose: a
  row that fails every time (a `23505` label collision, say) would otherwise
  stall the whole import for ever. It is loud — `failed_total`, a non-`ok`
  status and a Sentry issue — which a deferral is not, and deferrals are the
  case where holding the cursor is correct.
- Zero eligible activities → no writes beyond `last_run_at` and
  `last_run_status='noop'`, HTTP 200.

## Deletion: disconnect, revocation purge, deletion sync

Strava's API Policy requires that Strava data leaves when the athlete
disconnects, when the grant is revoked, and when an activity is deleted on
Strava (within 48 hours). Every path goes through a SECURITY DEFINER function
in migration 019, applying the per-link rule in **Provenance** above, under the
lock order sync row → token row → sessions → links.

**Disconnect** (`strava-connect`, `disconnect.ts`). The dashboard first asks
`disconnect_preview`, which calls `purge_strava_user(user, 'disconnect',
dry_run => true)` and returns the counts it would delete, keep and restore — no
Strava call, no write. The confirm (`disconnect` with `confirm: true`) then:
gets a live access token while the refresh token still exists (the token
store's `remove` is a no-op here — only the purge deletes the token row);
calls `purge_strava_user(user, 'disconnect', false)`, one transaction that also
deletes the token, OAuth-state and sync rows; and only if that succeeded,
revokes at Strava with a 5-second timeout. A failed purge changes nothing and
revokes nothing (502). A failed or timed-out revocation still returns 200 with
`revocation: "failed"`, as does a token that could not be read or refreshed
(Strava down at refresh): the purge still runs, but the grant may still stand.

**Revocation purge** (phase B of the `strava-import` cron, `purge.ts`). When
Strava refuses the grant — `invalid_grant` twice at refresh, or a 401 on a
listing or detail call with a token that checked out fresh — the run marks the
connection down (`connected = false`, `last_run_status = 'auth_failed'`) and
sets `purge_due_at` 21 days out. The deadline is set once and never pushed
later; a 401 does not delete the token row. Reconnecting clears `purge_due_at`.
Every cron invocation, after the per-athlete imports (and even when nobody is
connected), selects athletes with `connected = false` and `purge_due_at <=
now()` and calls `purge_strava_user(user, 'revocation', dry_run)`. The function
re-checks everything under its locks and answers `not_due`, `no_state` or
`reconnected` (a token row newer than the disconnect) instead of purging when
the selection was stale. No Strava call of any kind.

**Deletion sync** (inside `runImport`, `reconcile.ts`). After an import that
finished cleanly — backfill complete, no rate limit, daily cap, budget stop,
deferral or error — and when `reconcile_due_at` has passed:

1. read the links (`strava_link_inventory`);
2. list every Strava activity from two days before the earliest link date (or
   `backfill_from`, if earlier) — `after` fixed, paging until a well-formed
   page comes back short;
3. a link whose activity was not listed, and that existed before the listing
   started, is a candidate; more candidates than `max(3, 20% of the links)`
   aborts as implausible (`capped`);
4. each candidate's detail is fetched, and only a **404** confirms it gone;
5. `purge_strava_activities(user, gone, listing_started_at, dry_run)` removes
   them — never a link made after the listing started.

Its budget is 20 Strava calls and 20 seconds, cut to whatever the import left
of its own 50 calls / 20 s, and it stops at 50% of either Strava window (the
import stops at 80%). Every abort — `truncated`, `listing_failed`,
`listing_malformed`, `listing_empty`, `capped`, `detail_failed`, `error` —
happens before the delete RPC, and retries an hour later (`reconcile_due_at`);
a completed pass (`ok`, or `noop` with no links) is due again in 12 hours. A 429
also sets `rate_limit_resets_at`; a 401 is a revocation, as above. The result
is attached to the run as `reconcile` (counts and status; per-activity
`decisions` only on a dry run) and never changes the run's own status or
cursors.

**Race with an import in flight.** The purges lock the sync row `FOR UPDATE`;
`upsert_strava_session` and `adopt_strava_session` take it `FOR SHARE` first and
raise `P0003` once it is gone or disconnected. The importer stops the run there
— status `error`, code `unknown`, no further writes and no sync-state write.

## Status and error codes

`last_run_status` ∈ `ok | partial | noop | rate_limited | auth_failed | error`.
`last_error_code` ∈ `token_exchange_failed | refresh_failed | auth_failed |
rate_limited | upstream_5xx | insufficient_scope | db_write_failed | unknown`.

`auth_failed` now also covers a 401 on a listing or detail call (it used to be
`upstream_5xx` or a deferral), and schedules the purge. A run cut short by
`P0003` (the connection deleted mid-run) reports `error` / `unknown` and writes
no sync state. The deletion sync's own statuses live in the run's `reconcile`
field, not in these columns. The `strava-import` response is HTTP 207 when any
athlete's run ended `partial`/`error` or any revocation entry is `error`.

Both are CHECK-constrained. **There is deliberately no free-text error column**:
`String(e)` from a failed token exchange routinely carries the whole response
body, which for `/oauth/token` includes the tokens themselves — and
`strava_sync_state` is the one Strava table the browser can read. Detail goes to
Sentry; the row gets a bounded code.

## Refresh-token rotation, and one deviation from the spec

Strava **rotates the refresh token on every refresh**: the response carries a new
one and the presented one dies immediately. Dropping it does not fail now — it
fails about six hours later as an opaque 401.

The design called for `pg_advisory_xact_lock` held across read-refresh-write.
**That is not achievable from an edge function and was not implemented.** The
refresh is an HTTPS round trip sitting in the middle of the critical section, and
every PostgREST call is its own transaction on a pooled connection, so any lock
taken is released before the HTTP call is even made. A transaction-scoped lock
here would serialise nothing while looking like it did.

What holds the invariant instead is a **compare-and-swap on the write**:

```
update strava_tokens set ... where user_id = $1 and refresh_token = $presented
```

Only the worker that presented the token being replaced can write the rotation.
The loser matches zero rows, learns it lost, and uses the winner's stored access
token rather than overwriting it. Combined with the `invalid_grant` handling
below, no rotation is ever lost and the worst case is one wasted HTTP call.

`invalid_grant` is **not** treated as revocation on first sight — that is exactly
what a lost race looks like from the loser's side. The row is re-read and the
refresh retried once; only a **second consecutive** `invalid_grant` on a freshly
read token deletes the row and sets `auth_failed`. A real revocation fails twice;
a race does not. Deleting on the first failure would silently disconnect Strava,
with no symptom except activities quietly ceasing to appear.

## Security notes worth not undoing

- `strava_tokens`, `strava_oauth_state` and `strava_session_links` have RLS
  **enabled**, **no policies at all**, and nothing granted to `anon` or
  `authenticated`. That is the whole of their privacy from the browser. Adding
  a policy to `strava_tokens` would hand a token granting full read access to
  the athlete's entire Strava history to anything holding a session JWT.
  Migration 012 asserts there are none.
- RLS is **not forced**, on purpose. `postgres` and `service_role` both have
  `rolbypassrls = true` on this project, and `FORCE ROW LEVEL SECURITY` does not
  bind a BYPASSRLS role — so it protected nothing, while breaking 017's
  invariant that no public table is forced (a forced table would export only
  policy-visible rows). It was removed in #629.
- **The nightly backup excludes the four `strava_*` tables by name** (migration
  018, `backup_snapshot()`'s `v_excluded`). `backup_snapshot()` runs as
  `postgres`, which bypasses RLS, so the exclusion list is the only thing keeping
  the tokens out of `backup_snapshots`.
  `web/scripts/__tests__/strava-credential-backup.test.mjs` fails CI if a later
  migration redefines the function and drops one. `sessions` stays in the
  snapshot, whole.
- Agent sessions read `public.sessions_no_strava` (018), a `security_invoker`
  view that hides importer-inserted rows and shows adopted rows with the
  athlete's own `avg_watts` / `avg_hr`. The guardrail that points agents at it
  is #631; the connectors bypass RLS, so it is a rule, not enforcement.
- `strava_sync_state` is **SELECT-only** for `authenticated`, own row only.
- Both RPCs are `REVOKE ALL ... FROM public, anon, authenticated` and granted
  only to `service_role`. Revoking from `PUBLIC` is the load-bearing half —
  `PUBLIC` is the pseudo-role the default EXECUTE grant flows through. Migration
  `012` asserts all of this and fails loudly if it regresses.
- The user id always comes from the **verified bearer's `sub`** claim
  (`_shared/jwtSubject.ts`), never from a request body and never from an env var.
  `vitals-sync`'s `VITALS_USER_ID` is the counter-example, not the pattern.
- `strava-oauth-callback` is public, so **expected validation failures are not
  errors**: a malformed, expired or replayed `state` gets a 302 with
  `?strava=error&reason=state` and **nothing is reported to Sentry**. Otherwise
  an anonymous caller could drain the free plan's quota and blind monitoring for
  the whole org. Sentry hears only about token-exchange 5xx, DB write failure and
  unexpected throws.
- State redemption is **one atomic statement** (`update ... where redeemed_at is
  null returning user_id`), never check-then-set. That is what makes it
  single-use, and what makes a double-clicked Connect button land on the error
  page instead of exchanging the code twice.
- Granted scope is asserted to contain `activity:read_all` **after** the
  exchange; a narrower grant is not persisted and the fresh token is
  deauthorized immediately. `activity:read` omits private activities, so a
  narrower grant would produce a silently partial history — and the adoption
  pass would then insert duplicates for everything it could not see.
- A callback for a **different `athlete_id`** than the one already stored is
  refused (`reason=athlete_mismatch`). Blending two athletes into one training
  log is not a confidentiality problem, it is a corrupted history nobody can
  untangle.

## Tests

```bash
deno run --allow-env supabase/functions/strava-import/test.ts
```

391 assertions, TC-01 to TC-39 (TC-36 to TC-39: the deletion sync wired into
`runImport`, listing/detail 401 as a revocation, the purge deadline, `P0003`).
The #630 deletion paths have two more suites, run the same way:
`strava-import/deletion_test.ts` (92 — the deletion sync and the revocation
purge) and `strava-connect/test.ts` (31 — disconnect preview and confirm, and
the reconnect patch and its wiring into the callback; that one also needs
`--allow-read=strava-oauth-callback/index.ts`, run from `supabase/functions`). No network, no database, no dependence on the
machine's clock or timezone. Wired into `.github/workflows/ci-functions.yml`;
that job's steps are **hardcoded**, so a new function's tests are not
auto-discovered and need a step adding by hand.

- **TC-01 to TC-15** cover the pure functions: mapping, eligibility, adoption,
  cursors, budgets, refresh-token rotation, the cron guard.
- **TC-16 to TC-25** drive `runImport` itself against two fakes — a Supabase
  client implementing exactly the surface `importer.ts` uses (backed by a tiny
  in-memory sessions table, recording every call **in order**) and a
  `globalThis.fetch` stub, so the real `client.ts` runs. They pin the dry run's
  zero writes, re-import idempotence, that an adopted row is never duplicated,
  the per-activity failure isolation, the detail fetch and its deferral
  behaviour, the cursor-after-rows ordering, multi-page incremental completeness
  and the `status` precedence.
- **TC-26 to TC-32** pin the #629 changes: the eight eligible types and the
  rejected ones, the detail-fetch gate for rides, a ride with no power meter
  written with null `avg_watts`, the cycling adoption tolerance, the Garmin skip
  (no detail fetch, skipped before any write, cursor still advances),
  `p_device_name` reaching both RPCs, and the daily rate cap.
- **TC-33 to TC-35** pin the review fixes: a summary naming no device is
  detail-fetched so a Garmin named only on the detail is still skipped (and a
  fetch that cannot happen defers), the daily cap's precedence over every other
  stop reason, a daily-cap 429 on the detail fetch, and a legacy
  `source = 'strava'` row that keeps its duration and distance once adopted.

The fake client models only the RPCs' contract. The SQL itself is exercised by
the self-test at the end of migration 012, which runs when the migration is
applied.

Call **order** is asserted, not only call counts: two of the defects these tests
exist to pin (a cursor written before the rows it describes, a watermark moved
past unlisted activities) are ordering bugs that any count-based assertion
passes straight through.

`serviceClient` lives in `supaClient.ts` rather than `importer.ts` so that
`importer.ts` can import `SupabaseClient` as a **type only**. Deno erases a
type-only import without loading the module, so the suite drives `runImport`
with a structural fake and never needs `jsr:@supabase/supabase-js` in its module
graph. Moving `createClient` back into `importer.ts` makes every `runImport`
test unrunnable offline.

## Client-facing behaviour

- `strava-connect` `{action:"start"}` → `{ ok, authorize_url }`; send the browser there.
- `strava-connect` `{action:"disconnect_preview"}` → 200
  `{ ok: true, preview: { toDelete, toKeep, toRestore } }` (integers: imported
  sessions to delete; imported or orphaned sessions kept because they carry the
  athlete's own data; adopted sessions whose own figures come back). No write,
  no Strava call. Errors: 401 `{error:"unauthorized"}`, 500 missing env, 502
  `{error:"disconnect_preview_failed"}`.
- `strava-connect` `{action:"disconnect", confirm:true}` → 200
  `{ ok: true, disconnected: true, removed, kept, restored, revocation }`, where
  the counts are what was actually done and `revocation` is:
  - `revoked` — Strava accepted `POST /oauth/deauthorize`;
  - `failed` — it answered non-2xx, failed, or did not answer within 5 s; or
    no access token could be obtained to try with (the refresh hit a Strava
    outage, or the token read threw — both reported to Sentry). The data is
    gone, but the grant may still stand on the athlete's Strava account, and
    nothing here can revoke it any more: the UI must tell the user to remove
    SplitIQ in Strava → Settings → My Apps;
  - `not_attempted` — there was no grant to revoke: no token stored, or Strava
    had already refused it (`invalid_grant` twice), so access at Strava had
    already ended.

  Errors: 400 `{error:"confirm_required"}` when `confirm` is not exactly `true`
  (nothing is read or changed), 401, 500 missing env, and 502
  `{error:"disconnect_failed"}` — the purge failed, **nothing was changed and
  nothing was revoked**. `revokedAtStrava` no longer exists.
- The callback returns to `STRAVA_APP_REDIRECT_URL` with `?strava=connected` or
  `?strava=error&reason=<denied|state|code|exchange|insufficient_scope|athlete_mismatch|method|server>`.
- `strava-sync` returns the full `ImportResult` (200, or 207 when a run ended
  `partial`/`error`).
