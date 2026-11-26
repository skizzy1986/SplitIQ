-- 023_invite_codes.sql
-- Additive + reversible (#791). SplitIQ DEV ONLY.
-- Applied to SplitIQ dev only, 25 Nov 2026 about 6:30 PM Perth (AWST), on
-- Scott's yes at 6:28 PM. Never apply it to production: testers never get a
-- production account (D32). The invite-signup function that uses these tables
-- must not be deployed to production either.
--
-- WHAT THIS DOES: the server half of invite-code sign-up.
--   public.invite_codes     one row per code, stored as a sha256 hash. The code
--                           itself is shown once to Scott when he mints it and
--                           is never stored or committed. Limited use, an expiry,
--                           and an optional email the code is bound to.
--   public.invite_attempts  rate-limit ledger: a hash of the caller's address
--                           and a time. No code, no email. Rows older than a day
--                           are deleted on the next attempt.
--   invite_signup_claim()   one atomic step: rate-limit, then consume one use.
--   invite_signup_release() gives a use back when creating the account failed.
--
-- PRIVACY: RLS enabled, NO policies, nothing granted to anon or authenticated,
-- the same model as strava_tokens (012, 020). Only service_role (the edge
-- function) can call the two functions. Hashed codes are not personal data, but
-- a browser role that could read them could still probe for valid codes.
--
-- APPLY THIS FILE INSIDE ONE TRANSACTION (it opens its own). Supabase's default
-- privileges grant anon and authenticated on a new public table, so between
-- CREATE TABLE and the REVOKE the table would otherwise be reachable.

begin;

create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique
              check (code_hash ~ '^[0-9a-f]{64}$'),
  note        text,
  max_uses    integer not null default 1 check (max_uses between 1 and 50),
  uses        integer not null default 0,
  expires_at  timestamptz not null,
  bound_email text check (bound_email = lower(bound_email)),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (uses between 0 and max_uses)
);

create table public.invite_attempts (
  id           bigint generated always as identity primary key,
  ip_hash      text not null,
  attempted_at timestamptz not null default now()
);

create index invite_attempts_ip_time_idx
  on public.invite_attempts (ip_hash, attempted_at);
create index invite_attempts_time_idx
  on public.invite_attempts (attempted_at);

alter table public.invite_codes enable row level security;
alter table public.invite_attempts enable row level security;

revoke all on table public.invite_codes from public, anon, authenticated, service_role;
revoke all on table public.invite_attempts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.invite_codes to service_role;
grant select, insert, update, delete on table public.invite_attempts to service_role;

comment on table public.invite_codes is
  'Invite codes for SplitIQ dev testers (#791). code_hash is sha256 of the normalised code (upper case, no spaces or hyphens); the code itself is never stored. DELIBERATELY POLICY-LESS: RLS on, no policies, no grants to anon or authenticated. Minted by Scott with web/scripts/mint-invite-code.mjs. DEV ONLY.';
comment on table public.invite_attempts is
  'Rate-limit ledger for invite-signup (#791): a keyed hash of the caller address and a time, nothing else. Pruned on each attempt after one day. DELIBERATELY POLICY-LESS. DEV ONLY.';

-- One atomic step. Returns {status: ok|invalid|rate_limited, id?}. "invalid"
-- covers an unknown, revoked, expired, used-up or email-mismatched code on
-- purpose: the caller cannot tell which, so error copy cannot reveal it.
-- Limits: 10 attempts per address per 15 minutes, 200 in total per hour. Every
-- call counts, success or not, and counted attempts survive a refusal.
create function public.invite_signup_claim(
  p_code_hash text,
  p_email     text,
  p_ip_hash   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_recent  integer;
  v_all_recent integer;
  v_id         uuid;
begin
  delete from public.invite_attempts
    where attempted_at < now() - interval '1 day';

  select count(*) into v_ip_recent from public.invite_attempts
    where ip_hash = p_ip_hash and attempted_at > now() - interval '15 minutes';
  select count(*) into v_all_recent from public.invite_attempts
    where attempted_at > now() - interval '1 hour';

  insert into public.invite_attempts (ip_hash) values (p_ip_hash);

  if v_ip_recent >= 10 or v_all_recent >= 200 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- The single UPDATE is the whole check: two callers racing for the last use
  -- cannot both get it.
  update public.invite_codes
     set uses = uses + 1
   where code_hash = p_code_hash
     and revoked_at is null
     and expires_at > now()
     and uses < max_uses
     and (bound_email is null or bound_email = lower(p_email))
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create function public.invite_signup_release(p_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.invite_codes set uses = greatest(uses - 1, 0) where id = p_id;
$$;

revoke all on function public.invite_signup_claim(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.invite_signup_release(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.invite_signup_claim(text, text, text) to service_role;
grant execute on function public.invite_signup_release(uuid) to service_role;

comment on function public.invite_signup_claim(text, text, text) is
  'Rate-limit then consume one use of an invite code, atomically (#791). service_role only (the invite-signup edge function).';
comment on function public.invite_signup_release(uuid) is
  'Give back one use of an invite code when the account could not be created (#791). service_role only.';

-- Self-test on synthetic rows, in a subtransaction that always rolls back
-- (sentinel SQLSTATE 'SF023', the pattern 019 and 020 use). A failed assertion
-- raises a normal error and rolls the whole file back.
do $$
declare
  h1  constant text := repeat('a', 64);
  h2  constant text := repeat('b', 64);
  h3  constant text := repeat('c', 64);
  h4  constant text := repeat('d', 64);
  h5  constant text := repeat('e', 64);
  r   jsonb;
  v_id uuid;
begin
  begin
    insert into public.invite_codes (code_hash, max_uses, expires_at) values
      (h1, 1, now() + interval '1 day'),
      (h2, 1, now() - interval '1 minute'),
      (h4, 5, now() + interval '1 day');
    insert into public.invite_codes (code_hash, max_uses, expires_at, bound_email)
      values (h3, 1, now() + interval '1 day', 'bound@example.test');
    insert into public.invite_codes (code_hash, max_uses, expires_at, revoked_at)
      values (h5, 1, now() + interval '1 day', now());

    r := public.invite_signup_claim(h1, 'a@example.test', 'ip-1');
    if r->>'status' <> 'ok' then raise exception '023 self-test: a valid code was refused (%)', r; end if;
    v_id := (r->>'id')::uuid;
    r := public.invite_signup_claim(h1, 'a@example.test', 'ip-1');
    if r->>'status' <> 'invalid' then raise exception '023 self-test: a used-up code was accepted (%)', r; end if;
    perform public.invite_signup_release(v_id);
    r := public.invite_signup_claim(h1, 'a@example.test', 'ip-1');
    if r->>'status' <> 'ok' then raise exception '023 self-test: a released use was not given back (%)', r; end if;

    if public.invite_signup_claim(h2, 'a@example.test', 'ip-1')->>'status' <> 'invalid' then
      raise exception '023 self-test: an expired code was accepted';
    end if;
    if public.invite_signup_claim(h5, 'a@example.test', 'ip-1')->>'status' <> 'invalid' then
      raise exception '023 self-test: a revoked code was accepted';
    end if;
    if public.invite_signup_claim(h3, 'other@example.test', 'ip-1')->>'status' <> 'invalid' then
      raise exception '023 self-test: a code bound to another email was accepted';
    end if;
    if public.invite_signup_claim(h3, 'BOUND@example.test', 'ip-1')->>'status' <> 'ok' then
      raise exception '023 self-test: a bound code was refused for its own email';
    end if;
    if public.invite_signup_claim(repeat('f', 64), 'a@example.test', 'ip-1')->>'status' <> 'invalid' then
      raise exception '023 self-test: an unknown code was accepted';
    end if;

    -- Rate limit: 10 attempts per address in the window, then refused even
    -- for a valid code. ip-1 has made 8 attempts so far.
    perform public.invite_signup_claim(h4, 'a@example.test', 'ip-1');
    perform public.invite_signup_claim(h4, 'a@example.test', 'ip-1');
    r := public.invite_signup_claim(h4, 'a@example.test', 'ip-1');
    if r->>'status' <> 'rate_limited' then raise exception '023 self-test: the per-address limit did not hold (%)', r; end if;
    r := public.invite_signup_claim(h4, 'a@example.test', 'ip-2');
    if r->>'status' <> 'ok' then raise exception '023 self-test: another address was limited (%)', r; end if;

    raise exception using errcode = 'SF023', message = 'rollback synthetic rows';
  exception when sqlstate 'SF023' then
    null;
  end;
end $$;

-- Catalogue assertions: nothing reachable from the browser roles.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('invite_codes', 'invite_attempts')
      and not c.relrowsecurity
  ) then
    raise exception '023 self-test: RLS is not enabled on the invite tables';
  end if;
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname in ('invite_codes', 'invite_attempts')
  ) then
    raise exception '023 self-test: the invite tables must have no policies';
  end if;
  if has_table_privilege('anon', 'public.invite_codes', 'select')
     or has_table_privilege('authenticated', 'public.invite_codes', 'select')
     or has_table_privilege('anon', 'public.invite_attempts', 'select')
     or has_table_privilege('authenticated', 'public.invite_attempts', 'select') then
    raise exception '023 self-test: a browser role can read an invite table';
  end if;
  if has_function_privilege('anon', 'public.invite_signup_claim(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.invite_signup_claim(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.invite_signup_release(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.invite_signup_release(uuid)', 'execute') then
    raise exception '023 self-test: a browser role can call an invite function';
  end if;
  if not has_function_privilege('service_role', 'public.invite_signup_claim(text, text, text)', 'execute') then
    raise exception '023 self-test: service_role cannot call invite_signup_claim';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
