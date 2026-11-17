// purge.ts — the revocation purge (#630), phase B of the strava-import cron.
//
// When Strava refuses an athlete's grant the importer marks the connection down
// and schedules purge_due_at 21 days out (revokedPatch in state.ts). This sweep
// finds every athlete past that deadline and calls purge_strava_user
// (migration 019) with reason 'revocation'. The RPC re-checks every condition
// under row locks — still disconnected, still due, no reconnect in progress —
// so this selection is only a cheap pre-filter, never the authority.
//
// No Strava call of any kind, deauthorize included: the grant is already dead,
// and the purge must not depend on Strava being reachable.
//
// Type-only supabase-js import, for the reason importer.ts gives.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { captureFunctionError } from "../_shared/sentry.ts";

const FN = "strava-import";

export type RevocationStatus = "purged" | "would_purge" | "not_due" | "no_state" | "reconnected" | "error";

/** Counts and a status only. No activity id is ever returned (Gate 2, Q-D). */
export type RevocationResult = {
  userId: string;
  status: RevocationStatus;
  deleted: number;
  kept: number;
  restored: number;
  orphansUnlinked: number;
};

export type RevocationDeps = {
  supa: SupabaseClient;
  now?: () => number;
  /** Test seam; defaults to captureFunctionError. */
  report?: typeof captureFunctionError;
};

const KNOWN: ReadonlySet<string> = new Set(["purged", "would_purge", "not_due", "no_state", "reconnected"]);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Whether phase B landed. `reconnected` counts as not landed: the purge was
 * refused because a token newer than the disconnect exists, and if that
 * reconnect never finished (no connected sync row follows) the purge stays
 * blocked every night until someone looks. index.ts answers 207 on false.
 */
export function revocationLanded(results: RevocationResult[]): boolean {
  return results.every((r) => r.status !== "error" && r.status !== "reconnected");
}

/**
 * Throws only when the due-user selection itself fails (the caller reports it).
 * A failure for one athlete is that athlete's `error` entry and never stops the
 * others.
 */
export async function runRevocationPurge(
  deps: RevocationDeps,
  opts: { dryRun: boolean },
): Promise<RevocationResult[]> {
  const { supa } = deps;
  const report = deps.report ?? captureFunctionError;
  const now = deps.now ?? (() => Date.now());
  const nowISO = new Date(now()).toISOString();

  const { data: rows, error } = await supa
    .from("strava_sync_state")
    .select("user_id")
    .eq("connected", false)
    .lte("purge_due_at", nowISO);
  if (error) throw new Error(`revocation due-user read failed: ${error.code ?? "unknown"}`);

  const results: RevocationResult[] = [];
  for (const r of rows ?? []) {
    const userId = String((r as { user_id: string }).user_id);
    const entry: RevocationResult = { userId, status: "error", deleted: 0, kept: 0, restored: 0, orphansUnlinked: 0 };
    const { data, error: rpcErr } = await supa.rpc("purge_strava_user", {
      p_user_id: userId,
      p_reason: "revocation",
      p_dry_run: opts.dryRun,
    });
    if (rpcErr) {
      await report(FN, new Error(`purge_strava_user failed: ${rpcErr.code ?? "unknown"}`), {
        userId,
        stage: "revocation_purge",
      });
      results.push(entry);
      continue;
    }
    const o = (data ?? {}) as Record<string, unknown>;
    const status = String(o.status ?? "");
    if (!KNOWN.has(status)) {
      await report(FN, new Error("purge_strava_user returned an unknown status"), {
        userId,
        stage: "revocation_purge",
      });
      results.push(entry);
      continue;
    }
    if (status === "reconnected") {
      // Visible, not an error entry: a half-finished reconnect blocks the purge.
      // The message names the status only; no user, activity or token id.
      await report(FN, new Error("revocation purge blocked: purge_strava_user returned reconnected"), {
        stage: "revocation_purge",
      });
    }
    entry.status = status as RevocationStatus;
    entry.deleted = num(o.deleted);
    entry.kept = num(o.kept);
    entry.restored = num(o.restored);
    entry.orphansUnlinked = num(o.orphans_unlinked);
    results.push(entry);
  }
  return results;
}
