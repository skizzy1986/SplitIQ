// Slim createClient: Auth, PostgREST and Edge Functions only (#776).
// The app never uses Realtime or Storage, but `@supabase/supabase-js`'s
// createClient always constructs both and they land in the dashboard entry
// (~22 KB gzip). This facade reproduces the official auth-header wiring into
// PostgREST and Functions so sign-in, refresh, `.from()` and
// `functions.invoke` keep the same behaviour, without those packages.

import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { FunctionsClient } from '@supabase/functions-js';

// Identifies as the installed supabase-js so GoTrue / PostgREST see the same
// X-Client-Info they already accept. Bump this when @supabase/supabase-js
// is bumped in package.json.
const SUPABASE_JS_VERSION = '2.119.0';

const DEFAULT_AUTH_OPTIONS = {
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
};

function defaultClientInfo() {
  let env = 'web';
  if (typeof document === 'undefined') {
    if (
      typeof navigator !== 'undefined' &&
      navigator.product === 'ReactNative'
    ) {
      env = 'react-native';
    } else {
      env = 'node';
    }
  }
  return {
    'X-Client-Info': `supabase-js/${SUPABASE_JS_VERSION}; runtime=${env}`,
  };
}

function ensureBaseUrl(supabaseUrl) {
  const trimmed = supabaseUrl?.trim();
  if (!trimmed) throw new Error('supabaseUrl is required.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.');
  }
  try {
    const withSlash = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    return new URL(withSlash);
  } catch {
    throw new Error('Invalid supabaseUrl: Provided URL is malformed.');
  }
}

const isNewApiKey = (key) =>
  key.startsWith('sb_publishable_') || key.startsWith('sb_secret_');

// Mirrors supabase-js 2.119's fetchWithAuth, minus optional OTel propagation
// (off by default there too). Authorization is the session JWT, or the anon
// key when there is no session — except Functions + a new-format API key,
// which must not send the key as a Bearer.
function fetchWithAuth(
  supabaseKey,
  getSessionToken,
  customFetch,
  { omitApiKeyAsBearer = false } = {}
) {
  const fetchImpl = customFetch ?? globalThis.fetch.bind(globalThis);
  const allowKeyAsBearer = !(omitApiKeyAsBearer && isNewApiKey(supabaseKey));
  return async (input, init) => {
    const realToken = await getSessionToken();
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) headers.set('apikey', supabaseKey);
    if (!headers.has('Authorization')) {
      const bearer = realToken ?? (allowKeyAsBearer ? supabaseKey : null);
      if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export function createClient(supabaseUrl, supabaseKey, options = {}) {
  if (!supabaseKey) throw new Error('supabaseKey is required.');
  const baseUrl = ensureBaseUrl(supabaseUrl);
  const projectRef = baseUrl.hostname.split('.')[0];
  const authOptions = { ...DEFAULT_AUTH_OPTIONS, ...options.auth };
  const storageKey = authOptions.storageKey ?? `sb-${projectRef}-auth-token`;
  const headers = {
    ...defaultClientInfo(),
    ...(options.global?.headers ?? {}),
  };
  const customFetch = options.global?.fetch;

  const auth = new AuthClient({
    url: new URL('auth/v1', baseUrl).href,
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      ...headers,
    },
    storageKey,
    autoRefreshToken: authOptions.autoRefreshToken,
    persistSession: authOptions.persistSession,
    detectSessionInUrl: authOptions.detectSessionInUrl,
    storage: authOptions.storage,
    flowType: authOptions.flowType,
    fetch: customFetch,
  });

  const getSessionToken = async () => {
    const { data } = await auth.getSession();
    return data.session?.access_token ?? null;
  };

  const rest = new PostgrestClient(new URL('rest/v1', baseUrl).href, {
    headers,
    schema: options.db?.schema ?? 'public',
    fetch: customFetch ?? globalThis.fetch.bind(globalThis),
    wrapFetch: (fetchImpl) =>
      fetchWithAuth(supabaseKey, getSessionToken, fetchImpl),
  });

  const functionsUrl = new URL('functions/v1', baseUrl).href;
  const functionsFetch = fetchWithAuth(
    supabaseKey,
    getSessionToken,
    customFetch,
    { omitApiKeyAsBearer: true }
  );

  return {
    auth,
    from: (relation, fromOptions) => rest.from(relation, fromOptions),
    schema: (schema) => rest.schema(schema),
    rpc: (fn, args, rpcOptions) => rest.rpc(fn, args, rpcOptions),
    get functions() {
      // Copy headers so FunctionsClient.setAuth cannot mutate the shared
      // PostgREST header object. Official supabase-js shares the object;
      // we don't, because we never listen to auth events to keep it in
      // sync — wrapFetch reads the session on every request instead.
      return new FunctionsClient(functionsUrl, {
        headers: { ...headers },
        customFetch: functionsFetch,
      });
    },
  };
}
