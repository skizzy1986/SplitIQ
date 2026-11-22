// report-problem — binds handleReportProblem to the Edge Function runtime.
// JWT verification stays ON. See handler.ts.
import { captureFunctionError } from "../_shared/sentry.ts";
import { subjectFromAuthHeader } from "../_shared/jwtSubject.ts";
import { handleReportProblem } from "./handler.ts";

const FN = "report-problem";
const hits = new Map<string, number[]>();

Deno.serve((req: Request) =>
  handleReportProblem(req, {
    env: (key) => Deno.env.get(key),
    fetch: globalThis.fetch,
    now: () => Date.now(),
    hits,
    subject: subjectFromAuthHeader,
    capture: (error, context) => captureFunctionError(FN, error, context),
  })
);
