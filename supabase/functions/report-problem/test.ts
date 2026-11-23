import { serveRequest } from "./http.ts";

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
const WEBHOOK = "https://hooks.slack.com/services/T9/B9/very-secret-token";

function bearer(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `Bearer header.${payload}.sig`;
}

function request(body: unknown, sub?: string, method = "POST"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (sub) headers.set("authorization", bearer(sub));
  return new Request("http://localhost/report-problem", {
    method,
    headers,
    body: method === "GET" || method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

const report = {
  what: "The log did not save",
  steps: "Opened Train, then Log",
  version: "1.3.0",
  route: "/settings",
  platform: "web",
  email: "person@example.com",
  user_id: OTHER,
};

type Posted = { url: string; body: string };

function harness(opts: { webhook?: string; fail?: "throw" | "status" } = {}) {
  const posted: Posted[] = [];
  const errors: string[] = [];
  const hits = new Map<string, number[]>();
  let now = 1_000_000;
  const env = (key: string) => (key === "SLACK_WEBHOOK_BUGS" ? opts.webhook : undefined);
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    posted.push({ url, body: String(init?.body ?? "") });
    if (opts.fail === "throw") {
      throw new Error(`connect ${url}`);
    }
    if (opts.fail === "status") return Promise.resolve(new Response("no", { status: 500 }));
    return Promise.resolve(new Response("ok"));
  };
  const send = (req: Request) =>
    serveRequest(req, {
      env,
      now: () => now,
      fetch: fetchImpl,
      hits,
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
  return {
    posted,
    errors,
    send,
    advance(ms: number) {
      now += ms;
    },
  };
}

const hidden = (text: string) =>
  !text.includes("very-secret-token") && !text.includes("hooks.slack.com") &&
  !text.includes("person@example.com");

// Preflight keeps the Sentry headers functions.invoke sends.
const preflight = await serveRequest(
  new Request("http://localhost/report-problem", { method: "OPTIONS" }),
  { env: () => undefined },
);
check("options: 200", preflight.status === 200);
const allow = preflight.headers.get("Access-Control-Allow-Headers") ?? "";
check("options: allows sentry-trace and baggage", allow.includes("sentry-trace") && allow.includes("baggage"), allow);

const anon = harness({ webhook: WEBHOOK });
const noAuth = await (await anon.send(request(report))).text();
check(
  "missing bearer: 401 and no slack",
  noAuth.includes("unauthorized") && anon.posted.length === 0,
  noAuth,
);

const h = harness({ webhook: WEBHOOK });
const okRes = await h.send(request(report, USER));
const okBody = await okRes.text();
check("signed in: 200", okRes.status === 200 && okBody.includes('"ok":true'), okBody);
check("response hides the webhook and the email", hidden(okBody), okBody);
check("one slack post", h.posted.length === 1, h.posted.length);
const slack = JSON.parse(h.posted[0].body) as { text: string };
check("slack url is the secret", h.posted[0].url === WEBHOOK, h.posted[0].url);
check("slack text has the report, version, screen, platform and user id",
  slack.text.includes("The log did not save") &&
    slack.text.includes("Opened Train, then Log") &&
    slack.text.includes("Version: 1.3.0") &&
    slack.text.includes("Platform: web") &&
    slack.text.includes("Screen: /settings") &&
    slack.text.includes(`User: ${USER}`),
  slack.text);
check("slack text uses the jwt user, not the body user or the email",
  !slack.text.includes(OTHER) && !slack.text.includes("person@example.com"),
  slack.text);

const bad = harness({ webhook: WEBHOOK });
const badRes = await bad.send(request({ what: "   ", version: "1.3.0", route: "/settings", platform: "web" }, USER));
check("blank report: 400 and no slack", badRes.status === 400 && bad.posted.length === 0, badRes.status);

const android = harness({ webhook: WEBHOOK });
await android.send(request({ ...report, platform: "android", steps: null }, USER));
check("android platform is forwarded", android.posted[0].body.includes("Platform: android"), android.posted[0].body);

const limited = harness({ webhook: WEBHOOK });
let last = 0;
for (let i = 0; i < 5; i++) last = (await limited.send(request(report, USER))).status;
check("five reports are allowed", last === 200 && limited.posted.length === 5, limited.posted.length);
const blocked = await limited.send(request(report, USER));
check("sixth report is 429 and is not posted", blocked.status === 429 && limited.posted.length === 5, blocked.status);
const other = await limited.send(request(report, OTHER));
check("a different user is not limited by the first", other.status === 200, other.status);
limited.advance(60 * 60 * 1000);
const later = await limited.send(request(report, USER));
check("the limit resets after the hour", later.status === 200, later.status);

const down = harness({ webhook: WEBHOOK, fail: "throw" });
const downRes = await down.send(request(report, USER));
const downBody = await downRes.text();
check("slack throw: 502", downRes.status === 502, downRes.status);
check("slack throw: body hides the url", hidden(downBody), downBody);
check("slack throw: error reported without the url", down.errors.length === 1 && hidden(down.errors[0]), down.errors);

const httpFail = harness({ webhook: WEBHOOK, fail: "status" });
const httpRes = await httpFail.send(request(report, USER));
check("slack HTTP error: 502 and the url stays out of the body",
  httpRes.status === 502 && hidden(await httpRes.text()),
  httpRes.status);

const unset = harness({ webhook: undefined });
const unsetRes = await unset.send(request(report, USER));
const unsetBody = await unsetRes.text();
check("unset secret: 503, no slack, url not in the body",
  unsetRes.status === 503 && unset.posted.length === 0 && hidden(unsetBody),
  unsetBody);

const method = await harness({ webhook: WEBHOOK }).send(request(report, USER, "GET"));
check("GET is 405", method.status === 405, method.status);

console.log("\nRESULT:", pass, "passed,", fail, "failed");
if (fail) Deno.exit(1);
