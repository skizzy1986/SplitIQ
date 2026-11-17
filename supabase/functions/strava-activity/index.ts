// strava-activity — one session's Strava detail and streams for the session
// page (#647), cached server-side for at most six days in
// strava_activity_cache (migration 020). Deployed with JWT verification ON
// (the default; do NOT use --no-verify-jwt): the user id is read from the
// verified bearer, and nothing else identifies the caller.
//
// The shell is http.ts and the flow handler.ts; this file only binds them to
// Deno.serve, the environment and the real Supabase client (the one value
// import of supabase-js, via strava-import/supaClient.ts).
import { serviceClient } from "../strava-import/supaClient.ts";
import { serveRequest } from "./http.ts";

Deno.serve((req: Request) => serveRequest(req, { env: (k) => Deno.env.get(k), makeSupa: serviceClient }));
