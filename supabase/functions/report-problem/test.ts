import { subjectFromAuthHeader } from "../_shared/jwtSubject.ts";
import {
  BUGS_SLACK_SECRET,
  handleReportProblem,
  type ReportDeps,
} from "./handler.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, actual?: unknown) => {
  if (cond) {
    pass++;
    console.log("  PASS", name);
  } else {
    fail++;
    console.log("  FAIL", name, "->", JSON.stringify(actual));
  }
};

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WEBHOOK = "https://hooks.example.test/services/T00/B00/secret-value";

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bearer(sub: string): string {
  return `Bearer ${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub, email: "person@example.com" })}.sig`;
}

const report = {
  what: "The chart is blank",
  steps: "Open Today",
  version: "1.3.0",
  route: "#/today",
  platform: "web",
  email: "person@example.com",
  userId: OTHER,
};

type Sent = { url: string; body: string };
type Captured = { message: string; context: Record<string, unknown> };

function harness(over: Partial<ReportDeps> & { status?: number; throw?: Error } = {}) {
  const sent: Sent[] = [];
  const captured: Captured[] = [];
  const hits = over.hits ?? new Map<string, number[]>();
  const deps: ReportDeps = {
    env: (key) => (key === BUGS_SLACK_SECRET ? WEBHOOK : undefined),
    fetch: (url, init) => {
      sent.push({ url: String(url), body: String(init?.body ?? "") });
      if (over.throw) return Promise.reject(over.throw);
      return Promise.resolve(new Response("nope", { status: over.status ?? 200 }));
    },
    now: () => 1_700_000_000_000,
    hits,
    subject: (req) => subjectFromAuthHeader(req),
    capture: (error, context) => {
      captured.push({
        message: error instanceof Error ? error.message : String(error),
        context,
      });
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, sent, captured, hits };
}

async function post(deps: ReportDeps, body: unknown, auth: string | null = bearer(USER)) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (auth) headers.set("authorization", auth);
  const res = await handleReportProblem(
    new Request("http://localhost/report-problem", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    deps,
  );
  return { status: res.status, body: await res.json() };
}

const ok = harness();
const sentOk = await post(ok.deps, report);
const posted = JSON.parse(ok.sent[0]?.body ?? "{}") as { text?: string };
check("RP-01 signed-in report is accepted", sentOk.status === 200 && sentOk.body.ok === true, sentOk);
check("RP-01 posts to the webhook from the secret", ok.sent[0]?.url === WEBHOOK, ok.sent);
check("RP-01 slack text uses the verified user id", posted.text?.includes(`user: ${USER}`) === true, posted);
check("RP-01 body user id is ignored", posted.text?.includes(OTHER) === false, posted);
check("RP-01 email is not forwarded", posted.text?.includes("person@example.com") === false, posted);
check("RP-01 response does not contain the webhook", !JSON.stringify(sentOk.body).includes("secret-value"), sentOk.body);
check("RP-01 carries version, route and platform", posted.text?.includes("version: 1.3.0") && posted.text?.includes("route: #/today") && posted.text?.includes("platform: web"), posted);
check("RP-01 carries the report text", posted.text?.includes("what happened: The chart is blank") && posted.text?.includes("steps: Open Today"), posted);

const shout = harness();
await post(shout.deps, { ...report, what: "ping <!channel> <@U123> <#C123>", steps: "" });
const shouted = JSON.parse(shout.sent[0]?.body ?? "{}") as { text?: string };
check("RP-02 mentions are defanged", shouted.text?.includes("<!channel>") === false && shouted.text?.includes("< @") === true, shouted);

const routePing = harness();
await post(routePing.deps, { ...report, route: "#/today<!channel>", version: "1.3.0" });
const routeText = JSON.parse(routePing.sent[0]?.body ?? "{}") as { text?: string };
check("RP-02 a route cannot ping the channel", routeText.text?.includes("<!channel>") === false && routeText.text?.includes("route: #/today< !channel>") === true, routeText);

const anon = harness();
const anonRes = await post(anon.deps, report, null);
check("RP-03 missing bearer is 401", anonRes.status === 401 && anonRes.body.error === "unauthorized", anonRes);
check("RP-03 401 does not call Slack", anon.sent.length === 0, anon.sent);

const badSub = harness();
const badSubRes = await post(badSub.deps, report, bearer("not-a-uuid"));
check("RP-03 a non-uuid subject is 401", badSubRes.status === 401, badSubRes);

const invalid = harness();
const invalidRes = await post(invalid.deps, { ...report, platform: "ios" });
check("RP-04 an unknown platform is 400", invalidRes.status === 400 && invalidRes.body.error === "invalid report", invalidRes);
check("RP-04 invalid does not call Slack", invalid.sent.length === 0, invalid.sent);

const empty = harness();
const emptyRes = await post(empty.deps, { ...report, what: "   " });
check("RP-04 blank what happened is 400", emptyRes.status === 400, emptyRes);

const unset = harness({ env: () => undefined });
const unsetRes = await post(unset.deps, report);
check("RP-05 unset secret is 503 and does not call Slack", unsetRes.status === 503 && unsetRes.body.error === "not configured" && unset.sent.length === 0, unsetRes);

const limited = harness();
let last = { status: 0, body: {} as { error?: string } };
for (let i = 0; i < 5; i++) last = await post(limited.deps, report);
const blocked = await post(limited.deps, report);
check("RP-06 five reports are accepted", last.status === 200 && limited.sent.length === 5, last);
check("RP-06 the sixth is rate limited", blocked.status === 429 && blocked.body.error === "rate limited", blocked);
check("RP-06 the blocked report is not posted", limited.sent.length === 5, limited.sent.length);

const other = await post(limited.deps, report, bearer(OTHER));
check("RP-06 another user is not blocked", other.status === 200, other);

const later = harness({
  hits: limited.hits,
  now: () => 1_700_000_000_000 + 15 * 60 * 1000,
});
const after = await post(later.deps, report);
check("RP-06 the window reopens", after.status === 200, after);

const down = harness({ status: 500 });
const downRes = await post(down.deps, report);
check("RP-07 a Slack HTTP error is 502", downRes.status === 502 && downRes.body.error === "delivery failed", downRes);
check("RP-07 the 502 hides the webhook", !JSON.stringify(downRes.body).includes("secret-value"), downRes.body);
check("RP-07 capture records the status only", down.captured[0]?.message === "slack delivery failed: HTTP 500" && down.captured[0]?.context.status === 500 && !JSON.stringify(down.captured[0]).includes("secret-value") && !JSON.stringify(down.captured[0]).includes("The chart is blank"), down.captured);

const boom = harness({ throw: new Error(`connect failed ${WEBHOOK}`) });
const boomRes = await post(boom.deps, report);
check("RP-07 a thrown Slack error is 502", boomRes.status === 502, boomRes);
check("RP-07 capture strips the webhook from the error", boom.captured[0]?.message.includes("secret-value") === false && boom.captured[0]?.message.includes("[url]") === true, boom.captured);

const options = await handleReportProblem(new Request("http://localhost/", { method: "OPTIONS" }), harness().deps);
check("RP-08 preflight is 200", options.status === 200);

const get = await handleReportProblem(new Request("http://localhost/", { method: "GET" }), harness().deps);
check("RP-08 GET is 405", get.status === 405);

const indexSrc = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
check("RP-09 index reads the subject from the bearer", indexSrc.includes("subjectFromAuthHeader"));
check("RP-09 index does not embed a webhook URL", !indexSrc.includes("hooks.slack.com"));
check("RP-09 secret name", BUGS_SLACK_SECRET === "SLACK_WEBHOOK_BUGS");

console.log("\nRESULT:", pass, "passed,", fail, "failed");
if (fail) Deno.exit(1);
