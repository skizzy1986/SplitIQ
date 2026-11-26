import * as Sentry from '@sentry/react';

// Runtime error monitoring. Initialisation is gated on VITE_SENTRY_DSN so local
// dev and CI stay silent (no DSN → no-op) while production reports to Sentry.
// The DSN is never hardcoded — it comes from the environment, same as the
// Supabase keys. Returns true when Sentry was initialised, false when skipped.
//
// Note: the Sentry ingest host must also be present in the `connect-src` CSP
// directive in web/vercel.json, or every envelope is blocked before it leaves
// the browser. The org is EU-region, so that host is *.ingest.de.sentry.io.

// Only attach `sentry-trace`/`baggage` headers to our own backend. Without this
// the browser SDK propagates tracing headers to every outbound request, which
// leaks trace ids to third parties and trips their CORS preflights.
function tracePropagationTargets() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return [/^\//];
  try {
    return [/^\//, new URL(supabaseUrl).origin];
  } catch {
    return [/^\//];
  }
}

const PII_KEY_DENY = ['forwarded', '-ip', 'remote-', 'via', '-user'];

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    // VITE_SENTRY_ENVIRONMENT is injected from Vercel's VERCEL_ENV at build
    // time (see vite.config.js) so preview and production are distinguishable.
    // MODE is the fallback, which keeps local dev and CI reporting as they did.
    environment:
      import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    // browserTracing is NOT one of the browser SDK's default integrations, so
    // without this line tracesSampleRate below has nothing to sample and no
    // pageload/navigation spans are ever produced.
    integrations: [Sentry.browserTracingIntegration()],
    tracePropagationTargets: tracePropagationTargets(),
    // Conservative sampling to stay well inside a free-tier quota; raise later
    // if performance tracing proves useful.
    tracesSampleRate: 0.1,
    // v11 removed sendDefaultPii and made collection permissive by default:
    // left unset, it would ship cookies, user IP and every HTTP request and
    // response body — here, Supabase payloads of training and health data.
    // This block is the SDK migration guide's "preserve the v10 default", i.e.
    // what `sendDefaultPii: false` used to mean.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: PII_KEY_DENY },
        response: { deny: PII_KEY_DENY },
      },
      httpBodies: [],
      urlQueryParams: { deny: PII_KEY_DENY },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Redaction (#819, slice S0). Training, health and personal values (watts, heart
// rate, year of birth, dates, session labels) must never reach Sentry, and the
// places they can ride in on are the error text, the PostgREST `details` and
// `hint` fields, the fingerprint, and React Query keys. Everything below is a
// deterministic rule; nothing here reads or stores a value.
// ---------------------------------------------------------------------------

const PLACEHOLDER = '<redacted>';

// Postgres puts the offending values inside parentheses after fixed phrases:
//   Key (date, label)=(2026-11-26, Base 1) already exists.
//   Failing row contains (1, 237, ...).
// Both groups go, because the first names columns and the second holds values.
const KEY_TUPLE = /(\bKey\s*)\([^)]*\)(\s*=\s*\([^)]*\))?/gi;
const FAILING_ROW = /(\bFailing row contains\s*)\([^)]*\)/gi;
// A quoted literal that carries a digit is a value (`"237"`, `'1986-11-26'`).
// Quoted identifiers without digits (constraint and table names) stay.
const QUOTED_WITH_DIGIT = /"[^"]*\d[^"]*"|'[^']*\d[^']*'/g;
const DIGIT_RUN = /\d+/g;

export function redactMessage(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(KEY_TUPLE, (_m, lead, values) =>
      values
        ? `${lead}(${PLACEHOLDER})=(${PLACEHOLDER})`
        : `${lead}(${PLACEHOLDER})`
    )
    .replace(FAILING_ROW, `$1(${PLACEHOLDER})`)
    .replace(QUOTED_WITH_DIGIT, `"${PLACEHOLDER}"`)
    .replace(DIGIT_RUN, '#');
}

// Only a code or a name that looks like one survives. A PostgREST `code` is
// `42501` or `PGRST202`; an error `name` is an identifier.
const SAFE_CODE = /^[A-Za-z0-9_-]{1,32}$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function safeCode(value) {
  const code = value?.code;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined;
}

function safeName(value) {
  const name = value?.name;
  return typeof name === 'string' && SAFE_NAME.test(name) ? name : undefined;
}

// Field names of a message-less error object, so the Sentry title still says
// what kind of thing failed. Names only, never values.
function safeKeyNames(value) {
  return Object.keys(value)
    .filter((k) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(k))
    .slice(0, 20);
}

// postgrest-js rejects with a plain `{ code, details, hint, message }` object,
// not an Error. Sentry titles a non-Error capture by stringifying it, so every
// Supabase failure in the app arrived as one issue called "[object Object]".
// Wrapping restores a real message and stack without changing anything for the
// call sites that already pass an Error.
//
// The wrapped message is redacted, and an object with no message is described by
// its code and field names, never by JSON.stringify(value): that dumped
// `details` and `hint`, which carry the offending values.
function toError(value) {
  if (value instanceof Error) return value;

  let msg;
  if (typeof value?.message === 'string' && value.message) {
    msg = redactMessage(value.message);
  } else if (value !== null && typeof value === 'object') {
    const keys = safeKeyNames(value);
    if (keys.length === 0) {
      msg = 'Empty error object';
    } else {
      const code = safeCode(value);
      msg = `Error object without a message (${code ? `code ${code}; ` : ''}fields: ${keys.join(', ')})`;
    }
  } else {
    msg = redactMessage(String(value));
  }

  const wrapped = new Error(msg);
  const name = safeName(value);
  if (name) wrapped.name = name;
  return wrapped;
}

// What Sentry gets about the original rejection: its code and name, and nothing
// else. `details`, `hint` and `message` are the fields that carry values, and a
// deep copy of an arbitrary rejection would drag row payloads in too.
function originalFields(value) {
  if (value === null || typeof value !== 'object')
    return { value: redactMessage(String(value)) };
  const out = {};
  const code = safeCode(value);
  if (code) out.code = code;
  const name = safeName(value);
  if (name) out.name = name;
  return out;
}

// A real Error is passed through untouched when it is already clean. When its
// message carries a value, it has a cause chain, or it carries PostgREST's own
// `details` / `hint` properties, a redacted copy is captured instead, so the
// caller's Error is never mutated and nothing rides along on it.
function redactError(error, depth = 0) {
  const redactedMessage = redactMessage(error.message);
  const hasCause = error.cause !== undefined && error.cause !== null;
  const hasPayload = 'details' in error || 'hint' in error;
  if (redactedMessage === error.message && !hasCause && !hasPayload) {
    return error;
  }

  const copy = new Error(redactedMessage);
  const name = safeName(error);
  if (name) copy.name = name;
  if (typeof error.stack === 'string') {
    // V8 stacks open with "Name: message"; rebuild that header from the copy so
    // the original message is not carried in the stack. Other engines leave the
    // message out of the stack, so there is nothing to rewrite.
    const header = `${error.name}: ${error.message}`;
    copy.stack = error.stack.startsWith(header)
      ? `${copy.name}: ${copy.message}${error.stack.slice(header.length)}`
      : error.stack;
  }
  if (hasCause && depth < 5) {
    copy.cause =
      error.cause instanceof Error
        ? redactError(error.cause, depth + 1)
        : new Error(redactMessage(String(error.cause)));
  }
  return copy;
}

// React Query keys are sent to Sentry as context. A segment survives only when
// it is a plain word (`'sessions'`, `'erg-sessions'`); numbers, ids, dates and
// objects become `*`. Keys should carry no values at all (brief §4 Hooks); this
// is the net under that rule.
const SAFE_KEY_SEGMENT = /^[A-Za-z][A-Za-z_-]*$/;

export function redactQueryKey(key) {
  if (!Array.isArray(key)) return undefined;
  return key.map((s) =>
    typeof s === 'string' && SAFE_KEY_SEGMENT.test(s) ? s : '*'
  );
}

function redactContext(context) {
  if (!context || typeof context !== 'object') return context;
  const out = { ...context };
  if ('queryKey' in out) out.queryKey = redactQueryKey(out.queryKey);
  if ('mutationKey' in out) out.mutationKey = redactQueryKey(out.mutationKey);
  return out;
}

// Single call site for everything that wants to report a handled error. Hooks
// and caches pass their own identifying context so an issue in Sentry says
// which query or mutation produced it, not just that "something threw".
export function captureError(error, context) {
  if (!error) return;

  const safeContext = redactContext(context);

  if (error instanceof Error) {
    Sentry.captureException(
      redactError(error),
      safeContext ? { extra: safeContext } : undefined
    );
    return;
  }

  const wrapped = toError(error);
  // Every wrapped error is thrown from the same few call sites, so Sentry's
  // stacktrace-led default grouping merges unrelated DB failures into one
  // issue. Appending the postgrest code, else the redacted message, splits
  // them again.
  const discriminator = safeCode(error) || wrapped.message;
  Sentry.captureException(wrapped, {
    extra: { ...safeContext, originalError: originalFields(error) },
    fingerprint: ['{{ default }}', String(discriminator)],
  });
}
