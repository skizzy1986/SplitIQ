# invite-signup (#791)

Lets a tester with an invite code create their own account and choose their own
password, on the **dev** project only. Public sign-up stays off.

**Never deploy this to production** (`swdrueaserjzhuxnzmeu`). Testers never get
a production account (D32). The function refuses to run there, and does nothing
unless `INVITE_SIGNUP_ENABLED=true` is set as a secret on dev.

## Request and reply

```
POST /functions/v1/invite-signup
{ "email": "...", "password": "...", "code": "7K3M-9QWX-2BDF-HJ4R", "consent": true }
```

Reply is `{ "ok": true }` or `{ "ok": false, "error": "<code>" }`. The error codes
are `invalid`, `weak_password`, `consent_required`, `rate_limited`, `bad_request`,
`disabled` and `server`. `invalid` covers an unknown, expired, revoked, used-up or
wrong-email code **and** an email that already has an account, so the reply never
says which.

## How it works

1. `logic.ts` normalises the code, hashes it (SHA-256), and calls
   `invite_signup_claim` (migration `023_invite_codes.sql`). That function checks
   the code, takes one use, applies the rate limit and records the attempt, all in
   one atomic step.
2. It creates a confirmed user with the Auth admin API. The consent record and
   the invite id go in `app_metadata`, which the user cannot edit.
3. If the account could not be made, `invite_signup_release` gives the use back.
4. Once the account exists, it calls `sample_data_load` (migration
   `024_sample_data.sql`, #799) to stage about 8 weeks of made-up, labelled
   sessions in that account so the first screens are not blank. A failure there
   is reported and swallowed: the sign-up still succeeds. Set the secret
   `INVITE_SAMPLE_DATA=false` to switch this off.

The code itself is never stored; only its hash. Callers are recorded only as an
HMAC of their address, keyed with the service key.

## Deploying (Scott, dev only, after migration 023 is applied to dev)

Deployed to SplitIQ dev (`niytwgtsclzuhyggvbhd`) as v1 on 25 Nov 2026 about
6:30 PM Perth (AWST), after 023 was applied there on Scott's yes. That build
came from #812's branch (this function plus the sample-data auto-load), not
from this PR alone. Until `INVITE_SIGNUP_ENABLED=true` is set as a secret on
dev, it answers `disabled`.

```
supabase secrets set INVITE_SIGNUP_ENABLED=true --project-ref niytwgtsclzuhyggvbhd
supabase functions deploy invite-signup --no-verify-jwt --project-ref niytwgtsclzuhyggvbhd
```

`--no-verify-jwt` is needed because the caller has no session yet. The function
makes its own checks (see above).

## Minting a code

`node web/scripts/mint-invite-code.mjs --uses 1 --days 14 [--email x@y.z] [--note "Paul"]`
prints the code once, and the SQL to insert its hash. Run that SQL on dev only.

## Sample data (#799)

Every staged row is labelled `[Sample] ...`, carries `source = 'sample'` where
the table has one, and is listed in `public.sample_data_rows`. A tester clears
exactly those rows with `select clear_my_sample_data()` (a Settings button can
call it later); from SQL, `select sample_data_clear('<user id>')`. To load again
for an existing account: `select sample_data_load('<user id>')` as service_role
(add `, null, true` to force it into an account that already has sessions).

## Tests

From `supabase/functions`:
`deno run --allow-env --allow-read=invite-signup/index.ts invite-signup/test.ts`
