---
name: supabase-patterns
description: >
  How this project uses Supabase — client setup, query patterns, Edge Functions,
  and RLS considerations. Read when adding a new Supabase query, writing a hook,
  creating a migration, or building a new Edge Function.
---

## Client Setup

```js
// src/supabaseClient.js — do not change this file
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

Credentials come from Vite env vars. Never hardcode them. In development,
they live in `.env.local` (gitignored). In Vercel, set as environment variables.

## Tables

The live table set is the source of truth: list it with the Supabase MCP
`list_tables`, and reconcile migrations in `supabase/migrations/manifest.json`. The
write conventions for `sessions`, `vitals` and the rest are in root `CLAUDE.md`
§ Supabase data. Do not copy column lists here — they drifted before (`sessions.date`
is text `M/D/YY`, not `date`; `date_iso` is the generated column to order by).

Roles of the less obvious tables (moved from root `CLAUDE.md` in #424):

- `template_exercises` — per-template prescriptions (sets/reps/rpe, `set_plan` jsonb,
  timed holds).
- `strength_sets` — per-set actuals (weight/reps/rpe/warmup/hold), real logged data only.
- `workout_assignments` — template → date (`pending` / `in_progress` / `completed` /
  `skipped`); `StrengthLogger.jsx` uses it.
- `exercise_prefs` — per-user, per-exercise preferences (e.g. rest seconds).
- `exercise_media` — demo media per exercise: reference content, not user data.
- `backup_snapshots` — daily full-DB JSON snapshots written by the backup cron.

## Query Patterns

### Fetch sessions newest first
```js
const { data, error } = await supabase
  .from('sessions')
  .select('*')
  .order('date_iso', { ascending: false, nullsFirst: false })
  .order('id', { ascending: false })
```

### Insert a new session (used in LogSessionForm)
```js
const { error } = await supabase
  .from('sessions')
  .insert({
    user_id: userId, // explicit: auth.uid() does not resolve through the MCP connector
    date, // text M/D/YY; never name date_iso (generated, insert rejected)
    type,
    label,
    duration,
    srpe,
    exercises,
    status: 'logged'
  })
```

### Upsert vitals (as `supabase/functions/vitals-import-api/index.ts` calls it)
```js
await supa.rpc('upsert_vital', {
  p_user_id: userId,
  p_date: date,
  p_rhr: rec.rhr_bpm,
  p_hrv: rec.hrv_ms,
  p_sleep: rec.sleep_hours,
  p_bodyweight: rec.bodyweight_kg,
  p_source: 'google_health_api'
})
```
`rec` comes from `mapResponses` in `vitals-import-api/mapper.ts`. The RPC coalesces, so
a null argument never wipes a stored value.

## React Query Pattern (for new hooks)

When adding new Supabase queries, use React Query instead of raw useEffect:

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabaseClient'

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('date_iso', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
      if (error) throw error
      return data
    }
  })
}

export function useAddSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (session) => {
      const { error } = await supabase.from('sessions').insert(session)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] })
  })
}
```

## Edge Functions

Location: `supabase/functions/<name>/index.ts`
Runtime: Deno (not Node.js)
Deploy: `supabase functions deploy <name>`

List the current functions with `ls supabase/functions` (`_shared/` holds the Sentry
wrapper and other shared code).

## RLS (Row Level Security)

RLS is on for every table and is never bypassed from the client. User tables are
**owner-only**, the user taken from the verified JWT:
```sql
create policy "owner"
  on <table> for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
Shared reference tables (e.g. `exercises`, `exercise_media`) are read-only to any
signed-in user:
```sql
create policy "read" on <table> for select to authenticated using (true);
```

## Migrations

- **Naming:** `supabase/migrations/NNN_snake_case.sql` — three digits, the next
  free number. The `011` collision is grandfathered; no new collision is allowed.
- **Rollback:** `NNN_name_rollback.sql` alongside the forward file, required from
  014 on. Its header says **NOT auto-applied** and gives the order of operations.
- **Apply** via Supabase MCP `apply_migration` with `name` exactly equal to the
  file stem. DDL never goes through `execute_sql`. Read back every apply: the
  `list_migrations` row, a SELECT proving the change, and the security advisor.
- **Manifest:** `supabase/migrations/manifest.json` reconciles every forward file
  as `applied` (with the live version), `mirror`, `unapplied` (with reason) or
  `pending`. A PR that adds a file adds its entry; `npm run check:migrations`
  validates it. Merged is not done — see `WORKFLOW.md` § Database migrations.
- **EXECUTE rule (since 014):** new functions created by `postgres` are
  executable only by the owner and `service_role`. Client RPCs, and helpers
  evaluated under the caller's role (generated columns, CHECK, index expressions,
  RLS helpers), need an explicit
  `grant execute on function … to authenticated` (plus `anon` only when an
  unauthenticated path needs it) in their own migration. `create or replace`
  keeps the ACL; `drop` + `create` loses it, so re-grant after one. SECURITY
  DEFINER functions still revoke/grant explicitly and pin `search_path`.
- **After any `create extension` run as `postgres`,** read back the security
  advisor and the new functions' ACLs: 014's global revoke applies to every
  schema `postgres` creates functions in, so an extension's functions are born
  without PUBLIC EXECUTE and may need explicit grants.
- **Nightly snapshot coverage (since 017, #428):** every base table in `public`
  is in `backup_snapshot()`'s export by default, read from `pg_class`, so a new
  table needs no backup edit. A table holding credentials or secrets (tokens,
  keys) must add itself to the function's `v_excluded` array in its own
  migration. The payload is schema v2: rows sit under `tables`, with
  `schema_version`, `exported_at`, `excluded` and `counts` beside them; a row
  without `schema_version` is v1 (tables at the top level).
