# report-problem

Signed-in **Report a problem** from Settings. The app posts the report to this
function; the function posts one Slack message to the incoming webhook in the
Supabase secret `SLACK_WEBHOOK_BUGS` (the `#bugs` channel).

Deploy with **JWT verification ON** (the default). Do not pass `--no-verify-jwt`.
The user id in Slack is the verified bearer `sub`. A `userId` or `email` field
in the body is ignored, and the webhook URL is never returned to the client.

## Secret

Set in Supabase dashboard → Edge Functions → Secrets.

| Secret | Purpose |
|---|---|
| `SLACK_WEBHOOK_BUGS` | Slack incoming webhook. The URL must not be a `VITE_` variable or any other client config. |

If the secret is unset the function returns 503 `not configured` and does not call Slack.

The message contains the report text, optional steps, app version, route, platform
(`web`, `pwa` or `android`) and the user id. It does not contain the email.
The report text is whatever the user typed, so it can include personal detail.

## Rate limit

Five reports per user per 15 minutes, held in memory on the isolate that
handled the request. A new isolate starts empty. A limit that survives cold
starts would need a table; this function does not add one.

## Body

`what` (required), `steps` (optional), `version`, `route`, `platform`.
Each text field is capped at 2000 characters.
