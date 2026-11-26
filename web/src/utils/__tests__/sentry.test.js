import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Sentry from '@sentry/react';
import {
  initSentry,
  captureError,
  redactMessage,
  redactQueryKey,
} from '../sentry.js';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('initSentry', () => {
  it('no-ops when no DSN is configured', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    expect(initSentry()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initialises Sentry with the configured DSN and release', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_RELEASE', 'splitiq@1.3.0');

    expect(initSentry()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledOnce();

    const cfg = Sentry.init.mock.calls[0][0];
    expect(cfg.dsn).toBe('https://k@o1.ingest.de.sentry.io/1');
    expect(cfg.release).toBe('splitiq@1.3.0');
  });

  // v11 dropped sendDefaultPii (now silently ignored) and defaults to sending
  // cookies, user IP and all request/response bodies. Pin the restrictive
  // config so a future cleanup cannot quietly widen what leaves the browser.
  it('keeps data collection at the v10 restrictive default', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    initSentry();

    const cfg = Sentry.init.mock.calls[0][0];
    expect(cfg).not.toHaveProperty('sendDefaultPii');
    expect(cfg.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      queues: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    });
    for (const dir of ['request', 'response']) {
      expect(cfg.dataCollection.httpHeaders[dir].deny).toEqual(
        expect.arrayContaining(['forwarded', '-ip', 'remote-', 'via', '-user'])
      );
    }
  });

  // tracesSampleRate alone does nothing: browserTracing is not one of the
  // browser SDK's default integrations, so this assertion is what stops the
  // tracing config silently reverting to inert.
  it('enables browser tracing so tracesSampleRate is not inert', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');

    initSentry();

    expect(Sentry.browserTracingIntegration).toHaveBeenCalledOnce();
    const cfg = Sentry.init.mock.calls[0][0];
    expect(cfg.integrations).toEqual([{ name: 'BrowserTracing' }]);
    expect(cfg.tracesSampleRate).toBe(0.1);
  });

  // vite build sets MODE=production for every build, Vercel target included, so
  // without the injected override a preview deploy files under `production`.
  it('prefers the injected environment over MODE', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', 'preview');

    initSentry();

    expect(Sentry.init.mock.calls[0][0].environment).toBe('preview');
  });

  it('falls back to MODE when no environment is injected', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '');

    initSentry();

    expect(Sentry.init.mock.calls[0][0].environment).toBe(import.meta.env.MODE);
  });

  it('propagates trace headers to Supabase and same-origin only', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');

    initSentry();

    const cfg = Sentry.init.mock.calls[0][0];
    expect(cfg.tracePropagationTargets).toEqual([
      /^\//,
      'https://abc.supabase.co',
    ]);
  });

  it('falls back to same-origin when the Supabase URL is missing or unparseable', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.de.sentry.io/1');
    vi.stubEnv('VITE_SUPABASE_URL', 'not-a-url');

    initSentry();

    expect(Sentry.init.mock.calls[0][0].tracePropagationTargets).toEqual([
      /^\//,
    ]);
  });
});

describe('captureError', () => {
  it('forwards the error with its context as extra', () => {
    const error = new Error('boom');
    captureError(error, { queryKey: ['sessions'] });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: { queryKey: ['sessions'] },
    });
  });

  it('omits the extra payload when no context is given', () => {
    const error = new Error('boom');
    captureError(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });

  it('ignores a null error', () => {
    captureError(null);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('passes a real Error through untouched, with no fingerprint', () => {
    const error = new Error('boom');
    captureError(error, { source: 'useSessionLog' });

    const [captured, options] = Sentry.captureException.mock.calls[0];
    expect(captured).toBe(error);
    expect(options).toEqual({ extra: { source: 'useSessionLog' } });
    expect(options).not.toHaveProperty('fingerprint');
  });

  // The bug this replaces: postgrest-js rejects with a plain object, and Sentry
  // titled every one of them "[object Object]" — one merged, unreadable issue.
  it('wraps a postgrest error object so the issue is titled by its message', () => {
    captureError(
      {
        code: '42501',
        details: 'row violates policy',
        hint: 'check RLS',
        message: 'permission denied for table sessions',
      },
      { source: 'useSessions' }
    );

    const [captured, options] = Sentry.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('permission denied for table sessions');
    expect(captured.message).not.toBe('[object Object]');
    expect(options.extra.source).toBe('useSessions');
    // #819: only the code reaches Sentry. `details` and `hint` carry the values
    // Postgres objected to, so they stay out (see "captureError redaction").
    expect(options.extra.originalError).toEqual({ code: '42501' });
  });

  it('namespaces the original fields so they cannot collide with context keys', () => {
    captureError(
      { code: '42501', message: 'denied' },
      { code: 'caller-supplied' }
    );

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra.code).toBe('caller-supplied');
    expect(extra.originalError.code).toBe('42501');
  });

  it('does not deep-copy nested payloads out of the original error', () => {
    captureError({ message: 'denied', row: { user_id: 'u1', srpe: 9 } });

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra.originalError).not.toHaveProperty('row');
  });

  // Default grouping is stacktrace-led, so two different postgrest codes from
  // the same call site would otherwise merge into a single issue.
  it('fingerprints a wrapped error by its postgrest code', () => {
    captureError({ code: '42501', message: 'denied' });

    expect(Sentry.captureException.mock.calls[0][1].fingerprint).toEqual([
      '{{ default }}',
      '42501',
    ]);
  });

  it('falls back to the message when the wrapped error has no code', () => {
    captureError({ message: 'network request failed' });

    expect(Sentry.captureException.mock.calls[0][1].fingerprint).toEqual([
      '{{ default }}',
      'network request failed',
    ]);
  });

  // postgrest-js emits code: '' (never absent) for client-side/network
  // failures. ?? would not fall through on an empty string; the discriminator
  // must, or every network failure fingerprints as ['{{ default }}', ''].
  it('falls back to the message when the postgrest code is an empty string', () => {
    captureError({ code: '', message: 'network request failed' });

    expect(Sentry.captureException.mock.calls[0][1].fingerprint).toEqual([
      '{{ default }}',
      'network request failed',
    ]);
  });

  it('gives a message-less object something better than "[object Object]"', () => {
    captureError({});

    const captured = Sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).not.toBe('[object Object]');
    expect(captured.message.length).toBeGreaterThan(0);
  });

  it('survives a circular error object', () => {
    const circular = { code: 'X1' };
    circular.self = circular;

    captureError(circular);

    const captured = Sentry.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).not.toBe('[object Object]');
    expect(captured.message).toContain('code');
  });

  it('wraps a thrown string into an Error carrying that string', () => {
    captureError('something went wrong');

    const [captured, options] = Sentry.captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('something went wrong');
    expect(options.extra.originalError).toEqual({
      value: 'something went wrong',
    });
  });

  it('carries the original name onto the wrapped error', () => {
    captureError({ name: 'PostgrestError', message: 'denied' });

    expect(Sentry.captureException.mock.calls[0][0].name).toBe(
      'PostgrestError'
    );
  });

  it('leaves the default Error name alone when the original has none', () => {
    captureError({ message: 'denied' });

    expect(Sentry.captureException.mock.calls[0][0].name).toBe('Error');
  });
});

// #819, slice S0 (brief §6, §6a: H 42, A 54). A failed write to anchors, sessions
// or the training settings must not send a watt figure, a heart rate, a year of
// birth or a dated session label to Sentry, by any path: the original fields,
// the wrapped message, the fingerprint, a real Error, or a query key.
describe('captureError redaction (#819)', () => {
  const PAYLOAD = ['237', '172', '1986', '11/26/26'];

  // Everything Sentry would be handed for the call, as one string.
  function sent() {
    return JSON.stringify(
      Sentry.captureException.mock.calls.map(([captured, options]) => ({
        message: captured.message,
        name: captured.name,
        stack: captured.stack,
        cause: captured.cause && captured.cause.message,
        options,
      }))
    );
  }

  function expectNoPayload() {
    const out = sent();
    for (const value of PAYLOAD) expect(out).not.toContain(value);
  }

  const postgrest = {
    code: '23505',
    details: 'Key (date, label)=(11/26/26, Base 237 W) already exists.',
    hint: 'HR 172 bpm, born 1986',
  };

  it('H42/A54: no payload number survives originalFields, toError or the fingerprint', () => {
    // Variant 1: a message naming a constraint, plus details and hint.
    captureError({
      ...postgrest,
      message:
        'duplicate key value violates unique constraint "sessions_date_label_key"',
    });
    // Variant 2: no message at all, the toError JSON-fallback path.
    captureError({ ...postgrest });
    // Variant 3: Postgres quoting the value inside the message.
    captureError({
      code: '22P02',
      details: 'HR 172 bpm',
      hint: 'born 1986',
      message: 'invalid input syntax for type integer: "237"',
    });
    // The same three with no code, so the fingerprint falls back to the message.
    captureError({
      message: 'invalid input syntax for type integer: "237"',
      details: 'on 11/26/26',
    });

    expect(Sentry.captureException).toHaveBeenCalledTimes(4);
    expectNoPayload();
  });

  it('keeps the constraint name and the code, so issues still group', () => {
    captureError({
      ...postgrest,
      message:
        'duplicate key value violates unique constraint "sessions_date_label_key"',
    });

    const [captured, options] = Sentry.captureException.mock.calls[0];
    expect(captured.message).toBe(
      'duplicate key value violates unique constraint "sessions_date_label_key"'
    );
    expect(options.fingerprint).toEqual(['{{ default }}', '23505']);
    expect(options.extra.originalError).toEqual({ code: '23505' });
  });

  it('originalFields allows code and name only, never details, hint or message', () => {
    captureError({
      name: 'PostgrestError',
      code: 'PGRST202',
      message: 'Could not find the function save_my_cp(p_watts)',
      details: 'watts 237',
      hint: 'born 1986',
      srpe: 9,
    });

    const { extra } = Sentry.captureException.mock.calls[0][1];
    expect(extra.originalError).toEqual({
      name: 'PostgrestError',
      code: 'PGRST202',
    });
  });

  it('a code or name that does not look like one is dropped', () => {
    captureError({
      code: 'value 237 bpm',
      name: '1986',
      message: 'denied',
    });

    const { extra, fingerprint } = Sentry.captureException.mock.calls[0][1];
    expect(extra.originalError).toEqual({});
    expect(fingerprint).toEqual(['{{ default }}', 'denied']);
    expect(Sentry.captureException.mock.calls[0][0].name).toBe('Error');
  });

  it('toError with no message names the code and the fields, never JSON.stringify', () => {
    captureError({
      code: '23505',
      details: 'Key (date)=(11/26/26) already exists.',
      hint: '237',
    });

    const captured = Sentry.captureException.mock.calls[0][0];
    expect(captured.message).toBe(
      'Error object without a message (code 23505; fields: code, details, hint)'
    );
    expect(captured.message).not.toContain('{');
    expect(captured.message).not.toContain('already exists');
  });

  it('toError with no code still lists the field names only', () => {
    captureError({ details: '237', hint: '172' });

    expect(Sentry.captureException.mock.calls[0][0].message).toBe(
      'Error object without a message (fields: details, hint)'
    );
  });

  it('a thrown string is redacted too, in the message and in originalError', () => {
    captureError('save failed for 237 W on "11/26/26"');

    const [captured, options] = Sentry.captureException.mock.calls[0];
    expect(captured.message).toBe('save failed for # W on "<redacted>"');
    expect(options.extra.originalError).toEqual({
      value: 'save failed for # W on "<redacted>"',
    });
    expectNoPayload();
  });

  it('A54: no RHR, HRV or HR value reaches the error path', () => {
    captureError(new Error('resting HR 172 bpm and HRV 237 ms rejected'));
    captureError({
      code: '23514',
      message:
        'new row for relation "vitals" violates check constraint "vitals_rhr_bpm_check"',
      details: 'Failing row contains (2026-11-26, 172, 237, 1986).',
    });

    expectNoPayload();
    const out = sent();
    expect(out).not.toContain('Failing row contains (2026');
    // Identifier names without digits are kept, so the issue stays useful.
    expect(out).toContain('vitals_rhr_bpm_check');
  });

  describe('a real Error', () => {
    it('is passed through untouched when it carries no value', () => {
      const error = new Error('permission denied for table anchors');
      captureError(error);

      expect(Sentry.captureException.mock.calls[0][0]).toBe(error);
    });

    it("is captured as a redacted copy, and the caller's Error is not mutated", () => {
      const error = new Error('invalid input syntax for type integer: "237"');
      const before = { message: error.message, stack: error.stack };

      captureError(error);

      const captured = Sentry.captureException.mock.calls[0][0];
      expect(captured).not.toBe(error);
      expect(captured.message).toBe(
        'invalid input syntax for type integer: "<redacted>"'
      );
      expect(captured.stack).not.toContain('237');
      expect(error.message).toBe(before.message);
      expect(error.stack).toBe(before.stack);
      expectNoPayload();
    });

    it('drops PostgREST details and hint properties carried on an Error', () => {
      const error = Object.assign(new Error('denied'), {
        code: '42501',
        details: 'watts 237',
        hint: 'born 1986',
      });

      captureError(error);

      const captured = Sentry.captureException.mock.calls[0][0];
      expect(captured).not.toBe(error);
      expect(captured).not.toHaveProperty('details');
      expect(captured).not.toHaveProperty('hint');
      expectNoPayload();
    });

    it('redacts the cause chain as well', () => {
      const error = new Error('save failed', {
        cause: new Error('HR 172 bpm rejected', {
          cause: new Error('born 1986'),
        }),
      });

      captureError(error);

      const captured = Sentry.captureException.mock.calls[0][0];
      expect(captured.cause.message).toBe('HR # bpm rejected');
      expect(captured.cause.cause.message).toBe('born #');
      expect(JSON.stringify(captured, ['message', 'cause'])).not.toContain(
        '1986'
      );
    });

    it('adds no fingerprint, so default stacktrace grouping is unchanged', () => {
      captureError(new Error('value 237 rejected'));

      expect(Sentry.captureException.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe('query and mutation keys in context', () => {
    it('a value-free key passes through unchanged', () => {
      captureError(new Error('boom'), {
        source: 'react-query',
        kind: 'query',
        queryKey: ['strava', 'connection'],
      });

      expect(Sentry.captureException.mock.calls[0][1].extra.queryKey).toEqual([
        'strava',
        'connection',
      ]);
    });

    it('numbers, dates, ids and objects in a key become *', () => {
      captureError(new Error('boom'), {
        queryKey: ['sessions', 237, '1986-11-26', { hr: 172 }, 'detail'],
        mutationKey: ['anchors', 'save', 172],
      });

      const { extra } = Sentry.captureException.mock.calls[0][1];
      expect(extra.queryKey).toEqual(['sessions', '*', '*', '*', 'detail']);
      expect(extra.mutationKey).toEqual(['anchors', 'save', '*']);
      expectNoPayload();
    });

    it('a key that is not an array is dropped, not forwarded', () => {
      captureError(new Error('boom'), { queryKey: 'sessions-237' });

      expect(
        Sentry.captureException.mock.calls[0][1].extra.queryKey
      ).toBeUndefined();
    });

    it('the wrapped-object path redacts keys too', () => {
      captureError(
        { code: '42501', message: 'denied' },
        {
          queryKey: ['vitals', 172],
        }
      );

      expect(Sentry.captureException.mock.calls[0][1].extra.queryKey).toEqual([
        'vitals',
        '*',
      ]);
    });
  });
});

describe('redactMessage', () => {
  it('turns digit runs into #', () => {
    expect(redactMessage('237 W at 172 bpm')).toBe('# W at # bpm');
  });

  it('redacts quoted literals that carry a digit and keeps identifiers without one', () => {
    expect(
      redactMessage('constraint "anchors_status_check" value "1986"')
    ).toBe('constraint "anchors_status_check" value "<redacted>"');
    expect(redactMessage("date '2026-11-26' bad")).toBe(
      'date "<redacted>" bad'
    );
  });

  it('redacts the tuples after "Key (" and "Failing row contains"', () => {
    expect(
      redactMessage('Key (date, label)=(11/26/26, Base) already exists.')
    ).toBe('Key (<redacted>)=(<redacted>) already exists.');
    expect(redactMessage('Failing row contains (a, b, c).')).toBe(
      'Failing row contains (<redacted>).'
    );
  });

  it('is idempotent and leaves non-strings alone', () => {
    const once = redactMessage('Key (a)=(237)');
    expect(redactMessage(once)).toBe(once);
    expect(redactMessage(undefined)).toBeUndefined();
  });
});

describe('redactQueryKey', () => {
  it('keeps plain words, hyphens and underscores', () => {
    expect(redactQueryKey(['erg-sessions'])).toEqual(['erg-sessions']);
    expect(redactQueryKey(['lab_results'])).toEqual(['lab_results']);
    expect(redactQueryKey(['strengthPRs'])).toEqual(['strengthPRs']);
  });

  it('replaces anything else with *', () => {
    expect(redactQueryKey(['a', 'u-1', null, undefined, 5])).toEqual([
      'a',
      '*',
      '*',
      '*',
      '*',
    ]);
  });
});
