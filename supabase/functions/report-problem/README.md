# report-problem

Signed-in users send a short problem report from Settings. The function posts
it to the Slack incoming webhook in the Supabase secret `SLACK_WEBHOOK_BUGS`
(channel `#bugs`). The webhook URL is read on the server and is never returned
to the client.

## What is sent

The Slack message contains the text the person typed (what happened, and steps
if they gave any), the app version, the screen, the platform (`web`, `pwa` or
`android`) and the user id from the verified session JWT. It does not contain
the email address. The typed text leaves SplitIQ for Slack, a third party.

## Auth and limit

Deploy with JWT verification left on (the default). Do not pass
`--no-verify-jwt`: the user id is taken from the bearer token.

A signed-in user can send 5 reports per hour. The count is kept in the
function isolate, so a cold start clears it. That is enough for a basic limit
and needs no table. A limit shared across isolates would need a migration,
which this function does not add.

If `SLACK_WEBHOOK_BUGS` is unset the function returns `503` and does not throw
the secret name to the client. A Slack failure returns `502` and does not
include the webhook URL.

## Secret

Set `SLACK_WEBHOOK_BUGS` in the Supabase dashboard → Edge Functions → Secrets.
Do not put it in `web/.env` and do not prefix it with `VITE_`.
