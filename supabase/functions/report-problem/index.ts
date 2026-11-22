// report-problem — signed-in "Report a problem" posts one Slack message.
//
// Deployed with JWT verification ON (the default; do NOT use --no-verify-jwt).
// The gateway checks the session, then subjectFromAuthHeader reads `sub`.
// The webhook URL is the Edge Function secret SLACK_WEBHOOK_BUGS. It is read
// here and never written into a response.
import { captureFunctionError } from "../_shared/sentry.ts";
import { serveRequest } from "./http.ts";

const FN = "report-problem";

Deno.serve((req) =>
  serveRequest(req, {
    env: (key) => Deno.env.get(key),
    onError: (error, context) => captureFunctionError(FN, error, context),
  })
);
