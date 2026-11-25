import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient } from '../createClient.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://example.supabase.co';
const ANON = 'test-anon-key';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headerMap(headers) {
  return Object.fromEntries(new Headers(headers).entries());
}

let clientSeq = 0;

function makeClient(fetchImpl, authExtras = {}) {
  clientSeq += 1;
  return createClient(URL, ANON, {
    global: { fetch: fetchImpl },
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: memoryStorage(),
      // Unique per client so AuthClient does not warn about sharing a key
      // across instances in this file's jsdom.
      storageKey: `sb-example-auth-token-${clientSeq}`,
      ...authExtras,
    },
  });
}

describe('createClient facade (#776)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a missing URL or key with the same messages as supabase-js', () => {
    expect(() => createClient('', ANON)).toThrow('supabaseUrl is required.');
    expect(() => createClient('example.supabase.co', ANON)).toThrow(
      /Must be a valid HTTP or HTTPS URL/
    );
    expect(() => createClient(URL, '')).toThrow('supabaseKey is required.');
  });

  it('sends the anon key as apikey and Bearer on an unsigned PostgREST read', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const supabase = makeClient(fetchImpl);

    const { data, error } = await supabase.from('sessions').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toMatch(
      /^https:\/\/example\.supabase\.co\/rest\/v1\/sessions/
    );
    const headers = headerMap(init.headers);
    expect(headers.apikey).toBe(ANON);
    expect(headers.authorization).toBe(`Bearer ${ANON}`);
    expect(headers['x-client-info']).toMatch(
      /^supabase-js\/2\.119\.0; runtime=/
    );
  });

  it('sends the session JWT on PostgREST writes after sign-in, then the anon key after sign-out', async () => {
    const fetchImpl = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes('/auth/v1/token')) {
        return jsonResponse({
          access_token: 'user-jwt',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'refresh-1',
          user: { id: 'user-1', email: 'a@b.c' },
        });
      }
      if (url.includes('/auth/v1/logout')) {
        return new Response(null, { status: 204 });
      }
      if (url.includes('/rest/v1/sessions') && init?.method === 'POST') {
        return jsonResponse([{ id: 's1' }], 201);
      }
      if (url.includes('/rest/v1/sessions')) {
        return jsonResponse([]);
      }
      return new Response(`unexpected ${url}`, { status: 500 });
    });
    const supabase = makeClient(fetchImpl);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: 'a@b.c',
      password: 'secret',
    });
    expect(signInError).toBeNull();

    const { error: insertError } = await supabase
      .from('sessions')
      .insert({ sport: 'row' });
    expect(insertError).toBeNull();

    const write = fetchImpl.mock.calls.find(
      ([input, init]) =>
        String(input).includes('/rest/v1/sessions') && init?.method === 'POST'
    );
    expect(write).toBeTruthy();
    expect(headerMap(write[1].headers).authorization).toBe('Bearer user-jwt');
    expect(headerMap(write[1].headers).apikey).toBe(ANON);

    const { error: signOutError } = await supabase.auth.signOut();
    expect(signOutError).toBeNull();

    await supabase.from('sessions').select('*');
    const readAfter = fetchImpl.mock.calls.at(-1);
    expect(headerMap(readAfter[1].headers).authorization).toBe(
      `Bearer ${ANON}`
    );
  });

  it('picks up a refreshed access token on the next PostgREST request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const supabase = makeClient(fetchImpl);
    const sessionOf = (token) => ({
      data: {
        session: {
          access_token: token,
          refresh_token: 'r',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'user-1' },
        },
      },
      error: null,
    });
    const getSession = vi
      .spyOn(supabase.auth, 'getSession')
      .mockResolvedValueOnce(sessionOf('jwt-one'))
      .mockResolvedValueOnce(sessionOf('jwt-two'));

    await supabase.from('sessions').select('*');
    await supabase.from('sessions').select('*');

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(headerMap(fetchImpl.mock.calls[0][1].headers).authorization).toBe(
      'Bearer jwt-one'
    );
    expect(headerMap(fetchImpl.mock.calls[1][1].headers).authorization).toBe(
      'Bearer jwt-two'
    );
  });

  it('sends the session JWT on functions.invoke, including a JSON body', async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/auth/v1/token')) {
        return jsonResponse({
          access_token: 'fn-jwt',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'refresh-1',
          user: { id: 'user-1', email: 'a@b.c' },
        });
      }
      if (url.includes('/functions/v1/strava-sync')) {
        return jsonResponse({ ok: true });
      }
      return new Response(`unexpected ${url}`, { status: 500 });
    });
    const supabase = makeClient(fetchImpl);

    await supabase.auth.signInWithPassword({
      email: 'a@b.c',
      password: 'secret',
    });
    const { data, error } = await supabase.functions.invoke('strava-sync', {
      body: { force: true },
    });

    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    const invoke = fetchImpl.mock.calls.find(([input]) =>
      String(input).includes('/functions/v1/strava-sync')
    );
    expect(invoke).toBeTruthy();
    const headers = headerMap(invoke[1].headers);
    expect(headers.authorization).toBe('Bearer fn-jwt');
    expect(headers.apikey).toBe(ANON);
    expect(JSON.parse(invoke[1].body)).toEqual({ force: true });
  });

  it('falls back to the anon Bearer on functions.invoke when there is no session', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const supabase = makeClient(fetchImpl);

    const { error } = await supabase.functions.invoke('vitals-sync');
    expect(error).toBeNull();
    const headers = headerMap(fetchImpl.mock.calls[0][1].headers);
    expect(headers.authorization).toBe(`Bearer ${ANON}`);
    expect(headers.apikey).toBe(ANON);
  });

  it('does not send a new-format API key as the Functions Bearer when unsigned', async () => {
    const publishable = 'sb_publishable_testkey';
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const supabase = createClient(URL, publishable, {
      global: { fetch: fetchImpl },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: memoryStorage(),
      },
    });

    await supabase.functions.invoke('vitals-sync');
    const headers = headerMap(fetchImpl.mock.calls[0][1].headers);
    expect(headers.apikey).toBe(publishable);
    expect(headers.authorization).toBeUndefined();
  });

  it('exposes getUser, onAuthStateChange and the default storage key', async () => {
    const events = [];
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/auth/v1/token')) {
        return jsonResponse({
          access_token: 'user-jwt',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'refresh-1',
          user: { id: 'user-1', email: 'a@b.c' },
        });
      }
      if (url.includes('/auth/v1/user')) {
        return jsonResponse({ id: 'user-1', email: 'a@b.c' });
      }
      return new Response(`unexpected ${url}`, { status: 500 });
    });
    const supabase = makeClient(fetchImpl);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      events.push(event);
    });

    await supabase.auth.signInWithPassword({
      email: 'a@b.c',
      password: 'secret',
    });
    const { data, error } = await supabase.auth.getUser();
    expect(error).toBeNull();
    expect(data.user).toMatchObject({ id: 'user-1', email: 'a@b.c' });
    expect(events).toEqual(expect.arrayContaining(['SIGNED_IN']));

    // Official storage key is sb-<project-ref>-auth-token.
    const stored = await supabase.auth.getSession();
    expect(stored.data.session?.access_token).toBe('user-jwt');

    sub.subscription.unsubscribe();
  });

  it('does not import the supabase-js barrel, Realtime or Storage', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      join(dir, '../createClient.js'),
      join(dir, '../../supabaseClient.js'),
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(
        /from ['"]@supabase\/(supabase-js|realtime-js|storage-js)['"]/
      );
    }
  });

  it('does not expose Realtime or Storage', () => {
    const supabase = makeClient(vi.fn());
    expect(supabase.storage).toBeUndefined();
    expect(supabase.channel).toBeUndefined();
    expect(supabase.realtime).toBeUndefined();
  });
});
