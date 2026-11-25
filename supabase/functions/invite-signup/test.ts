// invite-signup test suite (#791). Same hand-rolled harness as the other
// functions, run the same way, from supabase/functions:
//
//   deno run --allow-env --allow-read=invite-signup/index.ts invite-signup/test.ts
//
// The read grant is for the static check of index.ts's guards. Everything else
// runs against fakes: no database, no network. What the SQL does to the rows is
// migration 023's self-test.
import {
  type Claim,
  CONSENT_VERSION,
  type CreateResult,
  type Deps,
  handleSignup,
  hashCode,
  isProductionUrl,
  normaliseCode,
} from "./logic.ts";
import { harness } from "../strava-import/testkit.ts";

const { check, finish } = harness();

// ---- code normalisation and hashing: the same vectors as the mint script ----

check("normalise: case, spaces and hyphens", normaliseCode(" 7k3m-9qwx 2bdf-hj4r ") === "7K3M9QWX2BDFHJ4R");
check("normalise: look-alikes fold (O to 0, I and L to 1)", normaliseCode("0o1il-ab") === "00111AB");
check(
  "hash: sha256 of the normalised code, lower-case hex",
  (await hashCode(normaliseCode("7k3m-9qwx-2bdf-hj4r"))) ===
    "a87ea262d1284861323b30eef0d41fd08450bdc355ff0af898c188c81fe5427e",
);

// ---- production guard ----

check("guard: production URL refused", isProductionUrl("https://swdrueaserjzhuxnzmeu.supabase.co"));
check("guard: dev URL allowed", !isProductionUrl("https://niytwgtsclzuhyggvbhd.supabase.co"));
check("guard: unreadable URL refused", isProductionUrl("not a url"));
check("guard: empty URL refused", isProductionUrl(""));

// ---- the handler, against fakes ----

type Calls = { claim: unknown[][]; release: string[]; create: unknown[]; errors: string[] };

function setup(opts: {
  enabled?: boolean;
  claim?: Claim | (() => Claim | never);
  create?: CreateResult | (() => CreateResult | never);
} = {}) {
  const calls: Calls = { claim: [], release: [], create: [], errors: [] };
  const deps: Deps = {
    enabled: opts.enabled ?? true,
    claim: (h, e, ip) => {
      calls.claim.push([h, e, ip]);
      const c = opts.claim ?? { status: "ok", id: "invite-1" };
      return Promise.resolve(typeof c === "function" ? c() : c);
    },
    release: (id) => {
      calls.release.push(id);
      return Promise.resolve();
    },
    createUser: (u) => {
      calls.create.push(u);
      const c = opts.create ?? { ok: true };
      return Promise.resolve(typeof c === "function" ? c() : c);
    },
    ipHash: (ip) => Promise.resolve(`h(${ip})`),
    now: () => new Date("2026-11-25T10:00:00Z"),
    onError: (where) => {
      calls.errors.push(where);
    },
  };
  return { deps, calls };
}

const good = { email: " Tester@Example.com ", password: "correct horse", code: "7k3m-9qwx-2bdf-hj4r", consent: true };

{
  const { deps, calls } = setup();
  const r = await handleSignup(good, "1.2.3.4", deps);
  check("valid code: ok", r.ok === true, r);
  check("valid code: email lower-cased and trimmed for the account", (calls.create[0] as { email: string }).email === "tester@example.com", calls.create);
  const claim = calls.claim[0] as string[];
  check("valid code: claims with the hash, the email and the address hash", claim[0].length === 64 && claim[1] === "tester@example.com" && claim[2] === "h(1.2.3.4)", claim);
  const meta = (calls.create[0] as { appMetadata: Record<string, unknown> }).appMetadata;
  check("valid code: consent recorded in app_metadata, not user_metadata",
    meta.tester === true && meta.invite_id === "invite-1" && meta.consent_version === CONSENT_VERSION &&
      meta.consented_at === "2026-11-25T10:00:00.000Z" && meta.age_declared_18_plus === true, meta);
  check("valid code: consent version is still the draft until Scott signs off", CONSENT_VERSION === "draft-1", CONSENT_VERSION);
  check("valid code: nothing released", calls.release.length === 0, calls.release);
}

const invalidReply = await handleSignup(good, "ip", setup({ claim: { status: "invalid" } }).deps);
check("unknown, expired, reused or mismatched code: invalid", invalidReply.ok === false && invalidReply.error === "invalid", invalidReply);
{
  const { deps, calls } = setup({ claim: { status: "invalid" } });
  await handleSignup(good, "ip", deps);
  check("invalid code: no user is created", calls.create.length === 0, calls.create);
}

{
  const { deps, calls } = setup({ create: { ok: false, code: "email_exists" } });
  const r = await handleSignup(good, "ip", deps);
  check("existing email: same reply as a bad code", JSON.stringify(r) === JSON.stringify(invalidReply), r);
  check("existing email: the code gets its use back", calls.release.join() === "invite-1", calls.release);
  check("existing email: not reported as an error", calls.errors.length === 0, calls.errors);
}
{
  const { deps } = setup({ create: { ok: false, code: "user_already_exists" } });
  const r = await handleSignup(good, "ip", deps);
  check("existing email (older code name): same reply as a bad code", JSON.stringify(r) === JSON.stringify(invalidReply), r);
}

{
  const { deps, calls } = setup({ claim: { status: "rate_limited" } });
  const r = await handleSignup(good, "ip", deps);
  check("rate limited", r.ok === false && r.error === "rate_limited", r);
  check("rate limited: no user is created", calls.create.length === 0, calls.create);
}

{
  const { deps, calls } = setup();
  const r = await handleSignup({ ...good, consent: false }, "ip", deps);
  check("consent false: consent_required", r.ok === false && r.error === "consent_required", r);
  const r2 = await handleSignup({ email: good.email, password: good.password, code: good.code }, "ip", deps);
  check("consent missing: consent_required", r2.ok === false && r2.error === "consent_required", r2);
  const r3 = await handleSignup({ ...good, consent: "true" }, "ip", deps);
  check("consent as a string: consent_required", r3.ok === false && r3.error === "consent_required", r3);
  check("no consent: the code is never touched", calls.claim.length === 0 && calls.create.length === 0, calls);
}

{
  const { deps, calls } = setup();
  const short = await handleSignup({ ...good, password: "short" }, "ip", deps);
  check("short password: weak_password", short.ok === false && short.error === "weak_password", short);
  const long = await handleSignup({ ...good, password: "x".repeat(73) }, "ip", deps);
  check("password over 72 bytes: weak_password", long.ok === false && long.error === "weak_password", long);
  check("weak password: the code is never touched", calls.claim.length === 0, calls.claim);
}
{
  const { deps, calls } = setup({ create: { ok: false, code: "weak_password" } });
  const r = await handleSignup(good, "ip", deps);
  check("server rejects the password: weak_password", r.ok === false && r.error === "weak_password", r);
  check("server rejects the password: the code gets its use back", calls.release.join() === "invite-1", calls.release);
}

for (const [name, body] of [
  ["null body", null],
  ["array body", []],
  ["no email", { ...good, email: undefined }],
  ["bad email", { ...good, email: "nope" }],
  ["password not a string", { ...good, password: 12345678 }],
  ["code too short", { ...good, code: "abc" }],
  ["code with symbols", { ...good, code: "ab!!ab!!ab!!ab!!" }],
] as const) {
  const { deps, calls } = setup();
  const r = await handleSignup(body, "ip", deps);
  check(`malformed (${name}): bad_request, nothing touched`, r.ok === false && r.error === "bad_request" && calls.claim.length === 0, r);
}

{
  const { deps, calls } = setup({ enabled: false });
  const r = await handleSignup(good, "ip", deps);
  check("disabled: refused before anything is read", r.ok === false && r.error === "disabled" && calls.claim.length === 0, r);
}

{
  const { deps, calls } = setup({ claim: () => { throw new Error("db down"); } });
  const r = await handleSignup(good, "ip", deps);
  check("claim throws: server error, reported once, no user", r.ok === false && r.error === "server" && calls.errors.join() === "claim" && calls.create.length === 0, { r, calls });
}
{
  const { deps, calls } = setup({ create: () => { throw new Error("auth down"); } });
  const r = await handleSignup(good, "ip", deps);
  check("createUser throws: server error and the use is released", r.ok === false && r.error === "server" && calls.release.join() === "invite-1", { r, calls });
}
{
  const { deps } = setup({ create: { ok: false, code: "unexpected_failure" } });
  const r = await handleSignup(good, "ip", deps);
  check("createUser fails for another reason: server", r.ok === false && r.error === "server", r);
}

// A reply never carries the code, its hash, the password or the email.
{
  const replies = [
    await handleSignup(good, "ip", setup().deps),
    await handleSignup(good, "ip", setup({ claim: { status: "invalid" } }).deps),
    await handleSignup(good, "ip", setup({ create: { ok: false, code: "email_exists" } }).deps),
  ].map((r) => JSON.stringify(r)).join("");
  const secrets = ["7K3M", "9QWX", "correct horse", "tester@example.com", await hashCode(normaliseCode(good.code))];
  check("replies never echo the code, hash, password or email", secrets.every((s) => !replies.includes(s)), replies);
}

// ---- index.ts guards, read as text ----

const src = await Deno.readTextFile("invite-signup/index.ts");
check("index.ts: needs INVITE_SIGNUP_ENABLED=true", src.includes('Deno.env.get("INVITE_SIGNUP_ENABLED") === "true"'));
check("index.ts: refuses the production project", src.includes("!isProductionUrl(url)"));
check("index.ts: users are created with the admin API, confirmed, no email sent", src.includes("auth.admin.createUser") && src.includes("email_confirm: true"));
check("index.ts: never reports the email, the code or the password to Sentry", !/captureFunctionError\([^)]*(email|password|code\b)/.test(src.replace(/where: "[a-zA-Z]+"/g, "")));

finish();
