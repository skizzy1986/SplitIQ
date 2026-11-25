// invite-signup logic (#791). Pure and dependency-injected so test.ts can drive
// every branch without a database or a network. index.ts wires the real ones.
//
// Contract with the testers form:
//   request   { email, password, code, consent: true }
//   response  { ok: true }  or  { ok: false, error }  — always HTTP 200 for the
//             outcomes below; only an unexpected failure is a 500.
//   error     invalid         the code or the details were not accepted. One
//                             answer for an unknown, expired, revoked, used-up or
//                             email-mismatched code AND for an email that already
//                             has an account, so the reply never says which.
//             weak_password   the password is too short or too weak
//             consent_required the consent tick was not sent
//             rate_limited    too many attempts; try again later
//             bad_request     a field is missing or malformed
//             disabled        this project does not take invite sign-ups
//             server          anything unexpected
// The reply never contains the code, its hash, or any secret.

export const PRODUCTION_REF = "swdrueaserjzhuxnzmeu";

// The wording the tick refers to. It stays "draft-1" until Scott signs off the
// notice (NOTICE-draft.md); the sign-off changes it to a dated version.
export const CONSENT_VERSION = "draft-1";

export const MIN_PASSWORD = 8;
// bcrypt, which GoTrue uses, ignores everything past 72 bytes.
export const MAX_PASSWORD_BYTES = 72;

export type ErrorCode =
  | "invalid"
  | "weak_password"
  | "consent_required"
  | "rate_limited"
  | "bad_request"
  | "disabled"
  | "server";

export type Reply = { ok: true } | { ok: false; error: ErrorCode };

export type Claim = { status: "ok"; id: string } | { status: "invalid" | "rate_limited" };

export type CreateResult = { ok: true } | { ok: false; code?: string };

export type Deps = {
  enabled: boolean;
  claim(codeHash: string, email: string, ipHash: string): Promise<Claim>;
  release(id: string): Promise<void>;
  createUser(
    user: { email: string; password: string; appMetadata: Record<string, unknown> },
  ): Promise<CreateResult>;
  ipHash(ip: string): Promise<string>;
  now(): Date;
  onError(where: string, error: unknown): Promise<void> | void;
};

/** Upper case, no spaces or hyphens, and Crockford's look-alike letters folded
 *  (O to 0, I and L to 1). web/scripts/mint-invite-code.mjs does the same. */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The function refuses to run against production, whatever else is set. */
export function isProductionUrl(url: string): boolean {
  try {
    return new URL(url).hostname.split(".")[0] === PRODUCTION_REF;
  } catch {
    return true; // an unreadable URL is not a project we know is safe
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Parsed = { email: string; password: string; code: string };

function parse(body: unknown): Parsed | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || typeof b.password !== "string" || typeof b.code !== "string") {
    return null;
  }
  const email = b.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  const code = normaliseCode(b.code);
  if (code.length < 8 || code.length > 40 || !/^[0-9A-Z]+$/.test(code)) return null;
  return { email, password: b.password, code };
}

export async function handleSignup(body: unknown, ip: string, deps: Deps): Promise<Reply> {
  if (!deps.enabled) return { ok: false, error: "disabled" };

  const parsed = parse(body);
  if (!parsed) return { ok: false, error: "bad_request" };
  const { email, password, code } = parsed;

  // Checked before the code is touched, so a form mistake costs no attempt
  // and no use of the code.
  if ((body as Record<string, unknown>).consent !== true) {
    return { ok: false, error: "consent_required" };
  }
  if (
    password.length < MIN_PASSWORD ||
    new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
  ) {
    return { ok: false, error: "weak_password" };
  }

  let claim: Claim;
  try {
    claim = await deps.claim(await hashCode(code), email, await deps.ipHash(ip));
  } catch (error) {
    await deps.onError("claim", error);
    return { ok: false, error: "server" };
  }
  if (claim.status === "rate_limited") return { ok: false, error: "rate_limited" };
  if (claim.status !== "ok") return { ok: false, error: "invalid" };

  const consentedAt = deps.now().toISOString();
  let created: CreateResult;
  try {
    created = await deps.createUser({
      email,
      password,
      // app_metadata, not user_metadata: a signed-in user can edit their own
      // user_metadata, but not this.
      appMetadata: {
        tester: true,
        invite_id: claim.id,
        consent_version: CONSENT_VERSION,
        consented_at: consentedAt,
        age_declared_18_plus: true,
      },
    });
  } catch (error) {
    created = { ok: false };
    await deps.onError("createUser", error);
  }

  if (created.ok) return { ok: true };

  // The account was not made, so the code gets its use back.
  try {
    await deps.release(claim.id);
  } catch (error) {
    await deps.onError("release", error);
  }
  if (created.code === "weak_password") return { ok: false, error: "weak_password" };
  // An email that already has an account looks exactly like a bad code.
  if (created.code === "email_exists" || created.code === "user_already_exists") {
    return { ok: false, error: "invalid" };
  }
  await deps.onError("createUser", new Error(`createUser failed: ${created.code ?? "unknown"}`));
  return { ok: false, error: "server" };
}
