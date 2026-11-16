# R37 — coach access specification

**Approved specification, 2026-11-15; coach access is not implemented.** Part of #511.
Read [R33 privacy research](PRIVACY_RESEARCH.md) and `VISION.md` first.
Approval and the development disposition are recorded in section 7. Coach-access
implementation remains separate from the self-use R38 work.

## 1. Outcome and boundaries

An adult athlete explicitly authorises one named coach to read their training and
calibration and write plans. Optional vitals and health categories each require a
separate grant. Any account can be athlete, coach or both; those are relationships,
not global account roles. Self-use remains complete without any relationship.

R37 approves a design only. R38 may migrate the self-use session layer and desktop
navigation after this spec is approved and the R33 disposition is recorded. Coach
access itself stays in R41–R43, after the existing H2 and R40 dependencies. This
change does not implement invitations, RLS, medication entry, a planner or coach UI.

## 2. Existing model and required additions

Repository evidence: migrations 006 (anchors/journal), 007 (strength), 008/010
(session dates/status), 012 (private integration credentials), 015/016 (BP/labs/
injuries). These include mirrors; R42 must reconcile the live catalogue before
writing migrations, following `manifest.json` and the normal migration workflow.

Proposed additive interfaces, with UUID keys and UTC server timestamps:

| Addition | Required contract |
|---|---|
| `coach_relationships` | `id`, immutable `athlete_id`/`coach_id`, `status` (`pending`, `active`, `revoked`), `accepted_at`, `revoked_at`, `notice_version`, `created_at`. No self-relationship; at most one non-revoked relationship for a pair. A revoked relationship is terminal; reconnect requires fresh consent and a new id. |
| `coach_grants` | Relationship id + category as unique key; `granted_at`, nullable `revoked_at`, notice version. Categories: `vitals`, `blood_pressure`, `medications`, `blood_panels`, `injuries`. Missing or revoked rows deny access. Only the athlete changes optional grants. |
| Private invitation records | UUID id, athlete, hashed random token, expiry, claimed coach, consumed/revoked timestamps. No raw token in the DB, URLs in logs, public account directory or list of registered emails. |
| Consent audit | Append-only relationship/category events with actor, subject, action, notice version and server time; no health payloads or raw tokens. Participants may inspect their relationship's events; neither may rewrite history. Retention is an operational decision before release, not an invented legal duration. |
| Session provenance | Nullable immutable `created_by` and `coach_relationship_id` on `sessions`; new writes record the verified actor. Historical nulls remain unknown. No historical `source='coach'` value is converted into a person's authorship. |
| `medication_records` | Owner-keyed typed rows: id, user_id, name, dose_text, started_on, optional ended_on and note, timestamps. Initially empty; no automated extraction of the journal. Owner RLS, coach read only with its specific grant, and no coach writes. Entry/import UI is separate from this spec. |

Training access includes `sessions`, `strength_workouts`, `strength_sets`, and the
related templates/exercises/assignments needed to explain those workouts. Template
and assignment ownership must match the workout owner; a cross-owner FK must not
become an access path. Shared exercise reference media is already a distinct case.

Calibration access covers `anchors` keys `rowing_cp`, `bike_ftp`, `current_phase`,
`current_block`, and `drag_factor`. `doctrine_sha` and future unknown keys remain
private. Scope is enforced in the DB, not a UI key filter.

`coach_log`, backups, integration tokens/OAuth state, sync credentials and exercise
preferences remain owner-only (or more restricted where already configured).
There is no coach read policy on a mixed journal. Medication sharing requires the
typed table above to exist; missing storage never falls back to journal access.

**Consent boundary:** the training grant includes the contents of shared training
rows, including any notes already stored there. Show that explicitly before consent:
free text can contain health details, and no text classifier can guarantee category
separation. Separate health grants control the typed health tables. An athlete who
does not want those training notes disclosed must review/remove them before granting
access. Do not describe unchecked health categories as a guarantee against health
information deliberately entered in the shared training log. A stricter notes
redaction product would need separately enforced storage/projections, not just a
frontend `select` list.

## 3. Invitation and consent lifecycle

1. An authenticated athlete creates a single-use invitation link, valid for 7 days,
   and shares it themselves. The app does not email it or search an account directory.
2. An authenticated, email-confirmed adult coach claims it. Claim binds the coach
   identity but grants no training access. Pending participants see only the identity
   and invitation metadata needed to confirm the relationship.
3. The athlete sees the claiming account's confirmed email and display name, reviews
   the training/calibration and plan-write scope, and explicitly accepts. Display
   names are not proof of professional qualifications. Optional grants start off;
   they are enabled separately with category-specific consent.
4. The athlete may revoke any category or the entire relationship. A coach may leave,
   which revokes that relationship. A coach cannot activate a relationship or add a
   grant. Revocation retains the athlete's own records and plan provenance.

Use server-side, authenticated, atomic transitions for create/claim/accept/revoke.
Claim requires row locking and consumes the token once; expiry and replay use the
same public invalid-invitation response. Re-check actor/relationship on every write.
An intercepted link alone never activates sharing. Rate-limit issuance and claims;
no account-existence responses, no public tokens/records, and no anonymous data read.

RPC contracts: `create_coach_invitation()` returns its invitation id, the one-time
link and expiry; `revoke_coach_invitation(id)` lets its issuing athlete revoke an
unclaimed invitation idempotently (after claim, revoke the pending relationship);
`claim_coach_invitation(token)` returns pending relationship identity;
`accept_coach_relationship(id, notice_version)`,
`set_coach_grant(id, category, enabled, notice_version)`, and
`revoke_coach_relationship(id)` return the current authorised state. Duplicate
accept/revoke calls are idempotent; claimed coach/athlete identities cannot change.
The version must match the current notice before a new acceptance/grant is written.
Revocation never requires accepting a new notice version; a stale notice cannot
prevent withdrawal. Grant mutations and their audit events succeed or fail in the
same transaction.

Enable RLS on all new lifecycle tables. Deny direct `INSERT`, `UPDATE` and `DELETE`
for both authenticated and anonymous browser roles on relationships, grants,
invitations and audit events; revoke those table privileges and add no browser DML
policies. Only the checked lifecycle RPCs may mutate them. Participant SELECT
policies expose minimal relationship/grant/audit metadata; invitation tokens and
hashes remain private. This prevents an athlete-owned UPDATE policy from bypassing
notice validation, final confirmation or the atomic audit. Privileged internal
mutation helpers are narrowly granted for those RPCs; no general table-write RPC.

If a lifecycle RPC requires `SECURITY DEFINER`, isolate internal helpers in a
non-exposed schema, fix `search_path`, fully qualify objects, check `auth.uid()` in
every entry point, revoke default PUBLIC/anon execution and grant only the exact
entry point. Public wrappers carry explicit checks. Do not use a general service-
role endpoint or a user-editable JWT claim to authorise requests. This exception
is for controlled lifecycle transitions, not a general RLS bypass for reading data.

## 4. Database read/write contract

Keep owner policies intact and add coach SELECT predicates only where specified.
An active relationship is required on every coach read; optional categories also
require an active matching grant. Use current DB state, not grant state embedded
in a JWT. Relationship and grant policies must avoid recursive policy lookups.
Participant metadata predicates do not depend on health-table policies.

| Resource | Active coach read | Coach mutation |
|---|---|---|
| Training log and its owned strength dependencies | Yes, for that athlete only | Only session plan operations below |
| Allowlisted calibration anchors | Yes | Never |
| Vitals | Only `vitals` grant | Never |
| BP / typed medication / labs / injuries | Only their respective grant | Never |
| Journal, backups, credentials, internal anchor keys | Never | Never |

Coach plan inserts must have status `planned`, the accepted athlete as owner, the
verified coach as creator and the active relationship id. Coach edits apply only
to their own still-planned rows. Allowed fields are date, type, label, duration and
plan instructions (`coach_note`); no actual metrics, PRs, exercise results, owner
changes or provenance changes. Cancellation may move their own planned row to
`cancelled`, once; no deletion, reactivation or completed-status transitions.
Provenance validation applies to owners too: browser inserts cannot forge another
creator, omit required new-write attribution, or attach a coach relationship to a
self-authored row. Coach inserts/edits require the exact active relationship,
not merely any currently active relationship for the pair. Reconnecting does not
restore a coach's edit rights to plans from a revoked relationship. The athlete
may still maintain or complete their own records after revocation; their retained
rows keep the original relationship id and creator without an active-grant check. Trusted import/backfill
paths must validate their actor/subject separately; the browser cannot select that
exception. Historical unknown authors stay unknown.

Owners retain control of their records and may complete a plan; afterward the coach
can no longer edit it. Other coaches cannot edit a plan they did not author.

RLS checks old and new states. Because RLS is row-level, a DB trigger must enforce
the coach field allowlist and immutable provenance even for direct REST writes;
a hidden UI or client adapter is insufficient. Keep plan status/source constraints
compatible with existing owner/import/PM5 writes. Do not reinterpret historical
`origin='coach'` or `coach_log.author='coach'`: label these as legacy/imported where
shown, and use `created_by` for new human coach attribution. No table rename or
rewriting historical records is required.

Views and RPCs are part of the access boundary. Any reachable view must use
`security_invoker` where supported, or be inaccessible to browser roles; audit
aggregates, joins, exports and FK errors for cross-athlete disclosure. Background
imports continue to authenticate the owner and never inherit coach scope.
[Supabase: RLS reference](https://supabase.com/docs/guides/database/postgres/row-level-security).

Revocation denies newly authorised server statements after its transaction commits,
including old JWTs. Already returned/in-flight data cannot be remotely recalled.
Coach views hold no persistent/offline athlete cache. Before entering a subject,
on focus and at least every 15 seconds while visible, revalidate access; clear and
hide that subject on denial or lease expiry. Offline coach views are unavailable.
This UI freshness bound does not replace statement-level DB checks.

## 5. R38 and R43 interface boundary

Four destinations on both layouts; no fifth Coach tab. R43 adds a labelled subject
selector to the shared shell, defaulting to the signed-in user's own log. Settings
owns relationships/invitations and sharing controls. When viewing an athlete:
Today summarises their shared training, Train shows/edits authorised plans,
Progress shows shared history, and Body shows only granted categories. Manual
athlete logging, vitals entry and device saves are unavailable in coach context.
A restricted Body section explains the missing grant without revealing row counts.

R38 builds the self-use version first, without a dead coach selector. Reserve a
subject id in query interfaces; optional future `athlete` query state in the hash
selects context only after an authorised relationship lookup. A crafted URL is
never authority. Unknown/revoked subjects return to self with an access message;
private data and a prior athlete's title are cleared together.

**Before any coach SELECT policy ships:** inventory every affected hook and direct
query. Each must filter the intended `user_id`, and each cache key must include
actor and subject. Owner-only RLS ceases to imply that an unfiltered query means
"my rows" once sharing exists. This includes load, anchors, vitals and strength,
not only sessions. Coach-context mutation adapters cannot silently reuse owner writes.

R38's session contract is a shared React Query reader with recent/full-history
modes, explicit owner subject, distinct keys, stable date_iso/id ordering and full
pagination. Its raw rows contain the union of existing callers' fields; pure
selectors retain desktop status/count/display semantics. Use `useSessionLog` only
as a temporary adapter. Session save/import/offline replay invalidates matching
subjects and analytics prefixes. Account change clears private caches; switching
subjects never reuses another subject's result. Existing self-use offline behavior
is retained; it does not automatically extend to coach mode.

## 6. Acceptance matrix and rollout

Use at least athlete A, athlete B, coach C, unrelated user D and an anonymous caller.
Tests exercise direct REST/table reads and writes as well as the UI and RPCs:

- Pending, expired, replayed, revoked and unknown invitations disclose no training.
  Two simultaneous claims cannot bind different coaches or activate sharing.
  Unclaimed invitation revocation defeats a later claim. Direct lifecycle-table
  writes cannot activate relationships, change grants, edit/omit audit events or
  bypass notice validation. An old notice does not block revocation.
- C reads A's training only after A accepts; C still cannot read B. User D, anon,
  wrong-subject URLs and forged client/JWT metadata fail closed.
- Toggle each optional grant independently; other categories remain denied. Test
  every lab panel, typed medication, related strength table, anchor key and view.
  Journal/backup/token reads remain denied even with every health grant enabled.
- Coach direct writes cannot alter metrics, owner, provenance, other coaches' plans,
  actual/completed rows, anchor values or health records. Owner inserts cannot forge
  coach authorship/relationships, and reconnecting cannot revive old plan edit rights.
  Concurrent completion vs
  coach edit has one valid serial outcome; the completed record cannot be overwritten.
- Revoke during a pending request, with an old JWT, after reconnect and after a
  fresh tab. New server access is denied, cached displays expire as specified,
  and the athlete's own history remains available.
- Own/athlete switches and account changes isolate caches. More than 50 sessions
  remain available in full-history mode; cancelled/planned rows are never counted
  as completed. Saves/imports refresh the intended subject only.
- R38 preserves all existing desktop surfaces under Today/Train/Progress/Body,
  reload/Back/Forward, Settings return focus, Strava callback feedback and live
  training state. `/squat` remains independent of Supabase and auth.

Order: R33 disposition + R37 approval → R38 self-use session PR → R38 desktop shell
PR. R41–R43 still wait for their roadmap dependencies, with R40 before coach-set
plans and H2 complete before coach-access implementation. R42 additionally requires
R31's per-user sessions uniqueness fix and the cross-query subject audit above.
Do not widen sharing against the current global date/label unique constraint.

Before enabling coach access, reconcile the live schema; apply additive, reversible
migrations with RLS/trigger/privilege tests and advisors; document notices, processor
and retention decisions, request/complaint ownership and breach response. Enable
only after owner/query regressions pass. Rollback first disables entry points and
coach policies, restoring owner-only reads; preserve athlete records, consent
history and provenance. No rollout, policy or DB change occurs in R37 itself.

## 7. Approval record

Scott approved this contract on 2026-11-15. He confirmed that privacy/legal matters
should receive due consideration, while development of the currently private,
non-commercial app must continue. R33's recommendation for a professional opinion
is recorded for consideration before enabling other people's data access; it is
not a prerequisite for self-use session/navigation development.

R37 is approved and R38 is unblocked. This does not claim a legal exemption, certify
compliance, enable sharing policies, or authorise public/commercial rollout. Coach
implementation and rollout retain their separate R41–R43 dependencies and reviews.


## R38 implementation notes

R38 is implemented in the #511 worktree without coach policies or schema changes.
Self-use history reads are paged and scoped to the authenticated owner; the old
independent reader is removed. On account changes private caches and active local
work are cleared. During upgrade, explicitly matching legacy payloads are retained;
unknown/mismatched draft/queue snapshots are copied into browser localStorage
`splitiq.unassigned-private-work` before being removed from active keys. This archive
has no UI/server upload and must be restored only after confirming the original
owner; it is not automatically assigned to the next account. If archiving cannot
write (e.g. quota), the original remains and strict producer/loader checks prevent
adoption. Confirm ownership before any manual recovery; never restore into another
user's session. This is a migration behavior, not a new sharing capability.
