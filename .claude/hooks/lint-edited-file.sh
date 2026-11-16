#!/usr/bin/env bash
# PostToolUse(Edit|Write): lint the file Claude just edited.
#
# Three things this gets right that the previous inline one-liner did not:
#
# 1. `$CLAUDE_PROJECT_DIR`, not a hardcoded /home/user/erg-dashboard. The old
#    path does not exist outside the original Linux sandbox, so the hook `cd`
#    failed and — because the failure exited 0 — reported success while doing
#    nothing. `$CLAUDE_PROJECT_DIR` does NOT follow a session into its worktree
#    (it stays at the main checkout), so a file under
#    <root>/.claude/worktrees/<name>/ is linted with that worktree's own eslint
#    and config, found by string match alone (#536).
# 2. It lints the file named in the tool call. The old form linted whatever the
#    first five entries of `git diff --name-only HEAD` happened to be, which
#    need not include the file that triggered the hook.
# 3. It invokes web/node_modules/.bin/eslint directly. The old form ran bare
#    `npx eslint` from the repo root, whose package.json declares only husky —
#    so npx cannot see the project's eslint and downloads one on demand
#    (observed: 10.9.1 fetched against the 10.8.1 the lockfile pins). That is a
#    network round-trip per edit and a version that drifts from the lockfile.
#    Flat-config lookup is not the problem: eslint resolves eslint.config.js
#    upward from the file being linted, so web/eslint.config.js is found from
#    anywhere in the repo.
#
# Advisory by design, and the output channel is the contract (#482). Plain
# stdout from a PostToolUse hook that exits 0 goes to the debug log, not to
# Claude, so the old "print findings, exit 0" reached nobody.
#
#   exit 0, nothing printed        clean file, or a file this hook does not lint
#   exit 0, one JSON object        findings, as hookSpecificOutput.additionalContext
#                                  (reaches Claude; never blocks — the edit applied)
#   exit 1, stderr, EMPTY stdout   lint did not run: misconfig, no eslint, crash
#
# Findings are not exit 2: that is PostToolUse's error path, and lint is advice,
# not a failed edit. Every non-zero exit keeps stdout empty because Claude Code
# ignores the exit code of a hook that also prints valid JSON and treats it as a
# success — a broken hook must not look like a clean one, which was #295.
#
# Subagents (#537): settings hooks also fire on a subagent's tool calls, with
# `agent_id`/`agent_type` in the payload, so the /orchestrate Build stage gets
# edit-time lint too. The findings go to that subagent's context, not the main
# thread's. This script ignores those fields: it lints the same file either way.
# https://code.claude.com/docs/en/hooks
set -uo pipefail

# Each path has two forms (#536). The fs form (backslashes -> /, no trailing
# slash) is the only one ever opened. The key form also maps /c/ -> C:/ and
# upper-cases the drive letter, and is used ONLY to compare paths: the Write
# tool sends C:\..., Git Bash may hand the root over as /c/..., and a literal
# match between the two silently skipped every edit — #295 again.
# Runs of / collapse to one, so web//src/ cannot miss scope; a leading // (UNC)
# is kept.
fs_form() {
  local p="${1//\\//}" lead=""
  case "$p" in //[!/]*) lead=/ && p="${p#/}" ;; esac
  while [[ "$p" == *//* ]]; do p="${p//\/\//\/}"; done
  [ "$p" = / ] || p="${p%/}"
  printf '%s' "$lead$p"
}
key_form() {
  local p d
  p="$(fs_form "$1")"
  case "$p" in
    /[A-Za-z]/*) p="${p:1:1}:${p:2}" ;;
    /[A-Za-z]) p="${p:1:1}:" ;;
  esac
  case "$p" in
    [A-Za-z]:*) d="${p:0:1}" && p="${d^^}${p:1}" ;;
  esac
  printf '%s' "$p"
}

root_raw="${CLAUDE_PROJECT_DIR:-}"
root="$(fs_form "$root_raw")"
if [ -z "$root_raw" ] || [ ! -d "$root" ]; then
  echo "[HOOK] lint-edited-file: CLAUDE_PROJECT_DIR unset or not a directory (${root_raw:-<unset>})" >&2
  exit 1
fi
rkey="$(key_form "$root")"

# The hook payload arrives as JSON on stdin. Parsed with node rather than the
# sed approach used by block-secret-commit.sh: a Windows path arrives as
# "C:\\Users\\scott\\..." and only a real JSON parser unescapes it correctly.
#
# node exits 3 if the payload will not parse, so an unreadable payload is
# reported rather than swallowed — a silent no-op here would be the same defect
# this hook is being fixed for.
if ! file="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.tool_input?.file_path??""))}catch{process.exit(3)}})')"; then
  echo "[HOOK] lint-edited-file: could not parse the hook payload as JSON" >&2
  exit 1
fi

# Parsed, but no file path — e.g. a tool call this matcher does not care about.
[ -n "$file" ] || exit 0

case "$file" in
  *.js | *.jsx | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac

ffs="$(fs_form "$file")"
fkey="$(key_form "$file")"

# The tree that owns the file: a worktree under <root>/.claude/worktrees/<n>/,
# else the root. <n> is the one segment after the prefix, cut at the first /
# (a case * would cross /).
tree="$root"
tkey="$rkey"
wt_prefix="$rkey/.claude/worktrees/"
case "$fkey" in
  "$wt_prefix"*)
    rest="${fkey#"$wt_prefix"}"
    n="${rest%%/*}"
    if [ -n "$n" ] && [ "$n" != "$rest" ]; then
      tree="$root/.claude/worktrees/$n"
      tkey="$wt_prefix$n"
    fi
    ;;
esac

web="$tree/web"
eslint="$web/node_modules/.bin/eslint"

# Mirror `npm run lint`, which covers only src/ and scripts/ under web/. Checked
# before the eslint binary, so an out-of-scope edit stays silent without deps.
case "$fkey" in
  "$tkey"/web/src/* | "$tkey"/web/scripts/*) ;;
  *)
    # Out of scope under the root is normal and silent, unless it misses only by
    # letter case (web/Src, .claude/Worktrees): Windows would open that file,
    # so a skip would be silent dead lint. Outside the root, a path that still
    # looks like web/src code means a normalisation miss or a worktree this hook
    # cannot see. Both are said out loud rather than exit 0 doing nothing.
    case "$fkey" in
      "$rkey"/*)
        rel="${fkey#"$rkey"/}"
        rel="${rel,,}"
        case "$rel" in
          .claude/worktrees/*/*)
            rel="${rel#.claude/worktrees/}"
            rel="${rel#*/}"
            ;;
        esac
        case "$rel" in
          web/src/* | web/scripts/*)
            echo "[HOOK] lint-edited-file: $file misses web/src or web/scripts only by letter case — not linted; check the path's case" >&2
            exit 1
            ;;
        esac
        exit 0
        ;;
      */web/src/* | */web/scripts/*)
        echo "[HOOK] lint-edited-file: $file looks like web/src code but is outside $root and its .claude/worktrees — not linted" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;
esac

# Deleted between the edit and the lint: eslint would exit 2 ("No files
# matching"), a false tooling alarm.
[ -f "$ffs" ] || exit 0

if [ ! -x "$eslint" ]; then
  echo "[HOOK] lint-edited-file: eslint not installed at $eslint — run 'npm install' in $web; edit-time lint is OFF" >&2
  exit 1
fi

errfile="$(mktemp)" || {
  echo "[HOOK] lint-edited-file: could not create a temp file for eslint stderr" >&2
  exit 1
}
trap 'rm -f "$errfile"' EXIT

cd "$web" || {
  echo "[HOOK] lint-edited-file: could not cd to $web" >&2
  exit 1
}

# --no-warn-ignored: a future global ignore must not turn an in-scope file into
# a "File ignored" warning that --max-warnings=0 would count as a finding.
lint_out="$("$eslint" --format json --max-warnings=0 --no-warn-ignored "$ffs" 2>"$errfile")"
lint_rc=$?

if [ "$lint_rc" -eq 0 ]; then
  exit 0
fi

if [ "$lint_rc" -ne 1 ]; then
  reason="$(grep -v -e '^[[:space:]]*$' -e '^Oops! Something went wrong! :($' -e '^ESLint: [0-9]' "$errfile" | head -n 1 | cut -c 1-200)"
  {
    echo "[HOOK] lint-edited-file: eslint failed to run (exit $lint_rc) — tooling/config problem, not a lint finding: ${reason:-no message}"
    head -n 20 "$errfile"
  } >&2
  exit 1
fi

# eslint exit 1: findings (errors, or warnings over --max-warnings=0). The JSON
# formatter carries each file's full source, so it is rendered down here, never
# forwarded raw. JSON.stringify does the escaping; bash never concatenates JSON.
# node exits 4 when the output is unreadable or holds no findings; any other
# non-zero means the builder itself broke.
ctx="$(printf '%s' "$lint_out" | HOOK_ROOT="$tree" HOOK_FILE="$ffs" node -e '
const path = require("path");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let results;
  try {
    results = JSON.parse(s);
    if (!Array.isArray(results)) throw new Error("not an array");
  } catch {
    process.exit(4);
  }
  const root = process.env.HOOK_ROOT;
  const rel = (p) => {
    const r = path.relative(root, p);
    return !r || r.startsWith("..") || path.isAbsolute(r) ? p : r.split(path.sep).join("/");
  };
  const findings = [];
  for (const res of results) {
    for (const m of res.messages || []) findings.push({ file: rel(res.filePath), m });
  }
  if (findings.length === 0) process.exit(4);
  const errors = findings.filter((f) => f.m.severity === 2).length;
  const warnings = findings.length - errors;
  const clip = (t) => {
    const c = String(t ?? "").replace(/\s+/g, " ").trim();
    return c.length > 160 ? c.slice(0, 159) + "\u2026" : c;
  };
  let text =
    `ESLint: ${findings.length} problem(s) (${errors} error(s), ${warnings} warning(s)) in ` +
    `${rel(process.env.HOOK_FILE)} \u2014 advisory, the edit was applied.`;
  let shown = 0;
  for (const { file, m } of findings) {
    if (shown >= 20) break;
    const line =
      `\n${file}:${m.line ?? 0}:${m.column ?? 0} ${m.severity === 2 ? "error" : "warning"} ` +
      `${clip(m.message)} [${m.ruleId || "parse-error"}]`;
    if (text.length + line.length > 3800) break;
    text += line;
    shown++;
  }
  const more = findings.length - shown;
  if (more > 0) {
    text += `\n\u2026 ${more} more problem(s) not shown. Run \u0027npm run lint\u0027 in web/ for the full list.`;
  }
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }),
  );
});
')"
build_rc=$?

if [ "$build_rc" -eq 4 ]; then
  echo "[HOOK] lint-edited-file: could not read eslint output (exit 1) — tooling problem, not a lint finding" >&2
  exit 1
fi
if [ "$build_rc" -ne 0 ] || [ -z "$ctx" ]; then
  echo "[HOOK] lint-edited-file: could not build hook output from eslint results" >&2
  exit 1
fi

printf '%s\n' "$ctx"
exit 0
