# SplitIQ dev database

The public-facing database for invited testers, pull-request previews and
development (D32, [#716](https://github.com/skizzy1986/SplitIQ/issues/716)).
Production is Scott's private database and is never a tester backend.

| | Project | Region |
|---|---|---|
| Dev | `niytwgtsclzuhyggvbhd` | Sydney (ap-southeast-2) |
| Production | `swdrueaserjzhuxnzmeu` | Tokyo |

No key, token or password belongs in this file. The dev project URL is public.

## What dev holds

At the build (below): production's structure and the public exercise
catalogue only. No sessions, vitals, health records, anchors, coach log, Strava
data, backups, templates, strength logs, accounts or secrets. Since then, dev
also has the tester-launch migrations 022 to 026 and the `invite-signup`
function (see [Changes since the build](#changes-since-the-build)), so it can
now hold invite codes, tester accounts, and the rows testers create, including
labelled sample data. Personal rows are never copied from production, and tester
rows are never copied back to it.

## How it was built (25 November 2026)

The repo migrations cannot rebuild the database from zero (see the note on `000`
in `supabase/migrations/manifest.json`), so dev was not built by replaying them.
The structure was read from production's catalog and applied to dev in one
transaction. Production was only read through catalog queries: no table rows.

1. **`014_revoke_default_function_execute`**, applied to dev first (the one
   numbered migration on dev).
2. **`baseline_schema_from_prod_catalog`**, applied as one transaction (counts
   are as built; see the log below for today's):
   extensions `pg_cron`, `http` and `pg_net` (no cron jobs); 18 functions; 21
   tables; constraints; 18 indexes; 8 views (with `security_invoker` kept); 5
   triggers; row-level security on all 21 tables; 22 policies; grants matching
   production's; comments. Structure only, no `INSERT` of data.
3. **Exercise seed**, `supabase/seed/exercises.sql`: 873 rows, run as a plain
   statement. `on conflict (id) do nothing` makes a re-run a no-op.
4. **`revoke_rls_auto_enable_execute`**: the platform's `rls_auto_enable()`
   helper is not callable by `anon`, `authenticated` or `PUBLIC`.

The baseline is not a numbered file in `supabase/migrations/`, and dev's
migration list is not the same as production's. Compare structure, not
migration names.

### Checks run afterwards

- **Fidelity.** One md5 per object (columns, constraints, indexes, policies,
  functions with bodies, grants on functions and relations, views, triggers,
  comments, extensions, event triggers) was computed on both projects and
  diffed. Dev has 631 items and production 628. Every shared item is identical.
  The only differences are allowed: dev has the platform's `ensure_rls` event
  trigger and its `rls_auto_enable()` helper (production has neither), and two
  extension patch versions differ (`pg_net` and `supabase_vault`).
- **Emptiness (counts on dev only, at build time).** Every public table had 0
  rows except
  `exercises` (873). `auth.users`, `auth.identities`, `auth.sessions`,
  `storage.buckets`, `storage.objects`, `vault.secrets` and `cron.job` were 0.
  That no longer holds once testers sign up; it hasn't been re-counted.
- **Exercise fingerprint.** The query below returns
  `149ed35cc65128b5ee354a997d7fdd79` on dev, the same value the seed generator
  pins and production returns.
- **Advisors.** No security errors. The remaining findings mirror production's
  design (policy-less server-only tables, a mutable search path on
  `fn_touch_updated_at`, `pg_net` in `public`, per-row `auth.uid()` in policies,
  one duplicate `vitals` index, unindexed foreign keys). They are left as they
  are so dev stays a faithful copy; any fix is a migration that goes to dev
  first, then production.

```sql
select md5(string_agg(concat_ws('|', id, name, force, level, mechanic,
  equipment, array_to_string(primary_muscles, ','),
  array_to_string(secondary_muscles, ','), array_to_string(instructions, '§'),
  category, array_to_string(images, ',')), E'\n' order by id collate "C"))
from public.exercises;
```

## Changes since the build

Every migration or function applied to dev after the build, newest last. Add a
line for each new one: what, when (Perth time), who approved it, and the PR.

| What | When (AWST) | Approved | PR |
|---|---|---|---|
| Migration `022_sessions_unique_per_user` (per-owner session key) | 25 Nov 2026, about 6:30 PM | Scott, 6:28 PM | #807 |
| Migration `023_invite_codes` (invite tables and claim/release functions) | 25 Nov 2026, about 6:30 PM | Scott, 6:28 PM | #808 |
| Migration `024_sample_data` (sample-data ledger and load/clear functions) | 25 Nov 2026, about 6:30 PM | Scott, 6:28 PM | #812 |
| Edge function `invite-signup` v1, `verify_jwt` off, built from #812's branch | 25 Nov 2026, about 6:30 PM | Scott, 6:28 PM | #812 (code in #808) |
| Migration `025_set_my_rowing_cp` (`set_my_rowing_cp` for testers) | 26 Nov 2026, 11:49 AM | Scott, 11:48 AM | #817 |
| Migration `026_sample_data_no_cp_anchor` (`sample_data_load` no longer inserts the 200 W `rowing_cp` placeholder) | 27 Nov 2026, 8:40 AM | Scott, 8:38 AM | #825 |

Each migration ran its own self-test on apply. `INVITE_SIGNUP_ENABLED` is not
set yet, so `invite-signup` answers `disabled` until it is. These are on dev
only; production has none of them (023, 024, 025, 026 and `invite-signup` never go there,
D32).

### Apply record: 026 (27 Nov 2026, 8:40 AM AWST)

Applied to dev only (`niytwgtsclzuhyggvbhd`), never production, with the Supabase
connector's `apply_migration` (name `026_sample_data_no_cp_anchor`, version
`20261127004011`), sending `026_sample_data_no_cp_anchor.sql` from #825's head
`9b9f783` byte for byte (20,704 bytes). Scott's yes: 8:38 AM AWST, 27 Nov 2026.
Existing sample CP anchors on dev were left in place. No rows were read from
`sessions`, `strava_*` or `backup_snapshots`, and no rows were deleted.

Read-back, catalogue only:

| Check | Before | After |
|---|---|---|
| `sample_data_load(uuid,date,boolean)` mentions `rowing_cp` or inserts into `public.anchors` | yes | **no** (also no `v_aid`) |
| Still has `c_cp := 200` (scale for sample session watts) | yes | yes |
| `prosecdef`, `proconfig` | true, `search_path=""` | true, `search_path=""` (unchanged, H 41 amendment) |
| ACL | `postgres`, `service_role` execute | `postgres`, `service_role` execute |
| `anon`, `authenticated` can execute the loader and `sample_data_clear` | no | no |
| `authenticated` can execute `load_my_sample_data` and `clear_my_sample_data`; `anon` cannot | yes, no | yes, no |
| `sample_data_clear`, `load_my_sample_data`, `clear_my_sample_data` definition md5 | `cdf05bea…`, `7a0cda55…`, `bb79c66e…` | identical |
| Loader definition md5 | `2930f6c4…` | `0101f2d9…` |
| Function comment | 024's | 026's ("Does not insert a rowing_cp anchor") |
| Migration listed | no | `026_sample_data_no_cp_anchor`, `20261127004011` |
| SF026 self-test | not run | ran inside the migration transaction and passed (the apply would have failed otherwise); it ends in a rolled-back sentinel, and a count-only check afterwards found 0 synthetic users, anchors, ledger rows or workouts |

Counts after these changes (catalogue only, 26 Nov 2026): 24 public tables,
all with row-level security on; 23 policies; 8 views. The build's 21 tables and
22 policies plus `invite_codes`, `invite_attempts`, `sample_data_rows` and its
one owner-select policy. By the migration files, 023, 024 and 025 add 7 functions to
the build's 18.

## Pending, not applied yet

| What | Status | PR |
|---|---|---|
| Migration `027_user_training_settings` (`user_training_settings`, `log_my_resting_hr`, `rate_my_session`, depth backfill) | **Not applied yet.** Waiting for Gate 3 and Scott's separate yes. Not applied to dev or to production. | #819 S3 |

When it is applied, the counts above become 25 public tables and 24 policies,
and the functions go up by 2. The backfill writes an `expert` depth row for each
account with a live, non-sample `rowing_cp`; Scott's yes on the apply covers
that write. This section moves into the log above, with the time and the
read-back, in the PR that records the apply.

## Vercel

On the `splitiq` project, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are
split by environment:

| Variable | Production | Preview |
|---|---|---|
| `VITE_SUPABASE_URL` | production project | dev project |
| `VITE_SUPABASE_ANON_KEY` | production client key | dev client key |

Preview builds therefore talk to dev, and the official site and `android-latest`
keep talking to production. The production-only integration variables
(`SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`, `POSTGRES_*`) are untouched. Vite reads
these at build time, so a preview built before the split still points at
production until it is rebuilt.

The GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` build
`android-latest` against production and stay as they are. A testers APK uses
separate secrets (#794).

## Rules

- Migrations go to dev first, are rehearsed there, then go to production after
  Scott's explicit yes. Applying a migration to either project is never part of
  a pull request.
- Functions that need Scott's Google Health or Strava credentials are not
  deployed to dev. `invite-signup` is deployed to dev, and it needs no
  personal credentials. Strava for testers (#800) and testers adding their own health
  data (#801) stay off until Scott turns them on.
- Public sign-up stays off on both projects.
- To refresh dev after a production migration, apply the same migration file to
  dev, then re-run the fidelity comparison. Do not copy rows. Log every apply or
  deploy in [Changes since the build](#changes-since-the-build). The fidelity
  comparison will now also show 022 to 026 as dev-only differences, until 022
  reaches production.

## Still open on #716

- `web/.env.example` with the dev URL and client key as defaults (Gate 2 item 4,
  one-off exception to `block-secret-commit.sh`).
- Local development and agent sessions pointed at dev (`docs/CLOUD_ENVIRONMENT.md`
  lists the host; the environment itself lives in claude.ai).
- `docs/DEV_ENVIRONMENTS.md` exists only on draft PR #689.
- Dashboard logins for Scott and Paul. Testers use the invite form instead
  ([#791](https://github.com/skizzy1986/SplitIQ/issues/791)).

## Superseded

The `supabase db dump` walkthrough written on 25 November is superseded by the
catalog build above. Nothing needs to be dumped, and there is no dump file to
delete.
