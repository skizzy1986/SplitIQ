#!/usr/bin/env bash
# PreToolUse guard on the Supabase SQL tools (#631): keep Strava data out of an
# agent's context window.
#
# Why: Strava's API Policy (s5.3) bars Strava data from being used in operating
# an AI application, including being read into a context window. The database
# roles behind the agent connectors bypass RLS, so nothing in the database can
# keep an agent out. This hook is a GUARDRAIL, NOT ENFORCEMENT: it blocks the
# obvious reads and says what to do instead. The rules it backs are in
# the Supabase doctrine, "Strava data and agent sessions" (private skill, #674).
#
# Merge order: this ships with or after migrations 012 and 018 are applied (the
# sessions_no_strava view joins strava_session_links) and before the owner's
# Strava OAuth grant; merged earlier, agents lose every sessions read for nothing.
#
# Contract (https://code.claude.com/docs/en/hooks): the payload is JSON on
# stdin with tool_name and tool_input; Supabase's execute_sql carries the SQL in
# tool_input.query. Exit 2 blocks the call and stderr is shown to the agent;
# exit 0 with no output lets it through. Every block below is an explicit exit 2.
# Any other exit is a hook failure; what that does is under "Failure behaviour".
#
# What it blocks, per statement, after stripping comments and string literals:
#   - the base table `sessions` as a token (bare, `public.` or
#     `<db>.public.`-qualified, quoted, any case) anywhere in the statement:
#     FROM, JOIN, USING, subquery, CTE. Another schema (`auth.sessions`) is not
#     blocked. A column alias or CTE named `sessions` trips it too; rename it.
#     Exception: a write that returns nothing - INSERT INTO sessions ... (no
#     SELECT), UPDATE sessions SET ..., DELETE FROM sessions ... - with no
#     RETURNING, no SELECT, no WITH, no FROM/USING of its own, and no second
#     mention of sessions. Read a write back through public.sessions_no_strava.
#   - any `strava_*` identifier (tables, and the strava_activity_id column);
#   - `backup_snapshots` (its payload holds sessions rows);
#   - a call to backup_snapshot() unless the result goes straight into a jsonb
#     key-presence operator (? ?| ?&), e.g.
#       select (public.backup_snapshot()->'tables') ? 'strava_tokens'
#     which returns a boolean, not rows. A judgement call: allowed.
#   - the planner statistics views and tables (pg_stats, pg_statistic,
#     pg_stats_ext, pg_stats_ext_exprs, pg_statistic_ext_data), which return
#     sampled column values (most_common_vals, histogram_bounds) from any table.
# Allowed: sessions_no_strava, every other relation, names that merely contain
# the word (session_id, session_date_to_iso(), sessions_archive), and catalogue
# queries that name these relations only inside string literals. Row-count
# catalogues (pg_class.reltuples, pg_stat_user_tables) are NOT blocked: they
# cannot be told apart by string matching; the rule makes those counts the
# owner's.
#
# Known limits - it is string matching on SQL, so it is defeatable:
#   - dynamic SQL built from literals (EXECUTE format('select ... from %I', ...)),
#     functions or views that read the table under another name, COPY, and
#     anything reached through a tool that is not execute_sql (run_notebook,
#     apply_migration, query_logs, the PostgREST API, psql in a shell);
#   - other agent hosts (Cursor, Codex) do not run Claude Code hooks;
#   - output pasted into a session by a person.
# The full list of residual paths is in the supabase-patterns.md section.
# Dollar-quoted bodies ($$...$$) are scanned as SQL, not stripped, because DO
# blocks and function bodies are code; a dollar-quoted literal naming sessions
# is therefore blocked (false positive, on the safe side). A table alias spelt
# `sessions` is blocked for the same reason. Quoted identifiers are compared
# case-insensitively, also on the safe side.
#
# Failure behaviour. This script blocks (exit 2) when it runs but cannot judge
# the call: node missing, payload not JSON, or tool_input.query not a string.
# It cannot cover its own failure to run. Per the hooks docs, a PreToolUse
# command hook that exits other than 0 or 2, cannot start (script missing:
# bash exits 127) or times out is a NON-blocking error and the call goes ahead,
# unless the entry sets "onFailure": "block" (Claude Code v2.1.295+), which
# makes each of those block the call. The settings entry sets it, with a
# 10-second timeout. An older Claude Code (not verified) would ignore the field
# and fail open. Failing
# closed costs only the Supabase SQL tools; failing open turns the guard off
# silently, the failure mode #295 was.
#
# If this misfires on every call (say a future payload change), the OWNER
# disables this one entry in .claude/settings.json and opens an issue. An
# agent never edits it out.
set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: the Strava data guard could not run (node not found), so Supabase SQL is blocked. Install node, or ask the owner to run the query. Rule: references/supabase-patterns.md in the anthropic-skills:splitiq skill." >&2
  exit 2
fi

# The payload is piped straight to node: an env var or argv would hit the
# Windows 32 KB limit, and execute_sql accepts queries up to about 2 MB.
node -e '
const FAIL = "BLOCKED: the Strava data guard could not read this tool call, so it is blocked. Ask the owner to run the query. Rule: references/supabase-patterns.md in the anthropic-skills:splitiq skill.";
const ADVICE = "Read sessions through public.sessions_no_strava. Dry-run output, sync results and any read-back that returns Strava data are run and read by the owner, not an agent. Rule: references/supabase-patterns.md in the anthropic-skills:splitiq skill, \"Strava data and agent sessions\".";

function block(msg) {
  process.stderr.write(msg + "\n");
  process.exit(2);
}

// Comments become a space; single-quoted literals (incl. E/U& prefixes)
// become an empty literal ""; double-quoted identifiers are unquoted;
// dollar-quote delimiters become a space and their bodies are kept as SQL.
function strip(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  const identChar = (c) => /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
    } else if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      out += " ";
    } else if (c === "\x27") {
      const prev = sql[i - 1] || "";
      const prev2 = sql[i - 2] || "";
      const escapes = /[eE]/.test(prev) && !identChar(prev2);
      i++;
      while (i < n) {
        if (escapes && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "\x27") {
          if (sql[i + 1] === "\x27") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += " \x27\x27 ";
    } else if (c === "\"") {
      let j = i + 1;
      let name = "";
      while (j < n) {
        if (sql[j] === "\"") {
          if (sql[j + 1] === "\"") { name += "\""; j += 2; continue; }
          j++;
          break;
        }
        name += sql[j++];
      }
      out += name;
      i = j;
    } else if (c === "$" && !identChar(sql[i - 1] || "")) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) { out += " "; i += m[0].length; }
      else { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// sessions bare, or qualified by a chain ending in public (public.sessions,
// postgres.public.sessions); any other qualifier (auth.sessions) is skipped.
const SESSIONS = /(^|[^\w$.])((?:[\w$]+\.)?public\.)?sessions(?![\w$])/g;
const STATS = /(^|[^\w$])(pg_stats|pg_statistic|pg_stats_ext|pg_stats_ext_exprs|pg_statistic_ext_data)(?![\w$])/;
const STRAVA = /(^|[^\w$])strava_[\w$]*/;
const SNAPSHOTS = /(^|[^\w$])backup_snapshots(?![\w$])/;
const SNAPSHOT_CALL = /(^|[^\w$])(public\.)?backup_snapshot\s*\(/g;
const SNAPSHOT_KEY_CHECK =
  /(^|[^\w$])(public\.)?backup_snapshot\s*\(\s*\)\s*(->\s*\x27\x27\s*)*\)?\s*\?[|&]?/g;

function isQuietWrite(stmt) {
  const s = stmt.trim();
  const write =
    /^insert\s+into\s+((\w+\.)?public\.)?sessions\b/.test(s) ||
    /^update\s+(only\s+)?((\w+\.)?public\.)?sessions\s+(as\s+\w+\s+|\w+\s+)?set\b/.test(s) ||
    /^delete\s+from\s+(only\s+)?((\w+\.)?public\.)?sessions\b/.test(s);
  if (!write) return false;
  if (/\b(returning|select|with|table|using)\b/.test(s)) return false;
  const froms = (s.match(/\bfrom\b/g) || []).length;
  if (froms > (s.startsWith("delete") ? 1 : 0)) return false;
  return (s.match(SESSIONS) || []).length === 1;
}

function verdict(query) {
  const text = strip(query).toLowerCase().replace(/\s*\.\s*/g, ".");
  for (const stmt of text.split(";")) {
    if (STRAVA.test(stmt)) return "a strava_* relation or column";
    if (SNAPSHOTS.test(stmt)) return "backup_snapshots (its payload holds sessions rows)";
    const calls = (stmt.match(SNAPSHOT_CALL) || []).length;
    const checks = (stmt.match(SNAPSHOT_KEY_CHECK) || []).length;
    if (calls > checks) return "the backup_snapshot() payload (only a ? key-presence check is allowed)";
    if (STATS.test(stmt)) return "planner statistics (pg_stats and relatives return sampled column values)";
    SESSIONS.lastIndex = 0;
    if (SESSIONS.test(stmt) && !isQuietWrite(stmt))
      return "the base table sessions (a column alias or CTE named sessions trips this too, e.g. count(*) as sessions; rename it)";
  }
  return null;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { block(FAIL); }
  const name = payload && payload.tool_name;
  // A broad matcher must not make this fire on an unrelated tool.
  if (typeof name !== "string" || !/^mcp__.*supabase.*__execute_sql$/i.test(name)) process.exit(0);
  const query = payload.tool_input && payload.tool_input.query;
  if (typeof query !== "string") block(FAIL);
  const hit = verdict(query);
  if (hit) block("BLOCKED: this query reads " + hit + ", which can hold Strava data; Strava\x27s API terms bar it from an agent\x27s context. " + ADVICE);
  process.exit(0);
});
'
