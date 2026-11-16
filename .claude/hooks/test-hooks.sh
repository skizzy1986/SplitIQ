#!/usr/bin/env bash
# Smoke test for the hooks in .claude/settings.json.
#
# The PostToolUse and Stop hooks were broken from the day they were written and
# nobody noticed for months, because both exited 0 while doing nothing (#295).
# The fix is only half the job; this is the half that keeps them fixed.
#
#   bash .claude/hooks/test-hooks.sh
#
# Exits 0 if every case passes, 1 otherwise.
#
# stdout and stderr are captured SEPARATELY, because since #482 the channel is
# the contract: findings are JSON on stdout with exit 0, and "lint did not run"
# is stderr with exit 1 and an EMPTY stdout (a hook that exits non-zero but
# prints valid JSON is read by Claude Code as a success).
#
# Every Stop case sets CLAUDE_CODE_REMOTE explicitly — the hook no-ops when it is
# "true", which it is in every cloud session, so a case that inherited it would
# silently test the remote path.
#
# Not tested here: a real eslint crash through a broken eslint.config.js (the
# stub in L8 drives the same branch without touching the real config); and
# concurrency. The wiring in .claude/settings.json is checked by
# web/scripts/check-hook-wiring.mjs, not here.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pass=0
fail=0

tmpd="$(mktemp -d)" || exit 1
# Probe files in web/src/utils carry a per-run tag, and only this run's are
# removed: a __hooktest*.js glob here deleted a concurrent run's files mid-case.
tag="$$_${RANDOM}"
probes=()
probe() { # probe <var> <name>: sets <var> to a per-run probe path, registered for cleanup
  local f="$root/web/src/utils/__hooktest_${2}_${tag}__.js"
  probes+=("$f")
  printf -v "$1" '%s' "$f"
}
trap 'rm -rf "$tmpd"; rm -f -- "${probes[@]}"' EXIT

# A path that cannot exist in any environment, local or cloud. The sentinel used
# to be the literal /home/user/erg-dashboard the old hook hardcoded, which is
# exactly where a cloud session checks the repo out — a test against hardcoded
# paths must not hardcode one.
missing="$root/.hook-missing-dir-probe-does-not-exist"

# ---- harness -----------------------------------------------------------------
rc=0 out="" err="" why=""

run() { # run <stdin> <command...>   sets rc, out (stdout), err (stderr)
  printf '%s' "$1" > "$tmpd/in"
  shift
  out="$("$@" < "$tmpd/in" 2> "$tmpd/err")"
  rc=$?
  err="$(cat "$tmpd/err")"
}

begin() { why=""; }
bad() { why="${why}${why:+; }$1"; }
done_case() { # done_case <name>
  if [ -z "$why" ]; then
    echo "ok    $1"
    pass=$((pass + 1))
  else
    echo "FAIL  $1 — $why"
    echo "      exit: $rc"
    echo "      stdout: $out"
    echo "      stderr: $err"
    fail=$((fail + 1))
  fi
}

expect_exit() { [ "$rc" = "$1" ] || bad "expected exit $1, got $rc"; }
expect_stdout_empty() { [ -z "$out" ] || bad "expected empty stdout"; }
expect_stderr_empty() { [ -z "$err" ] || bad "expected empty stderr"; }
expect_stderr_has() { printf '%s' "$err" | grep -qF -- "$1" || bad "stderr lacks: $1"; }
expect_stderr_line1_is() { [ "$(printf '%s\n' "$err" | head -n 1)" = "$1" ] || bad "stderr line 1 is not: $1"; }
expect_stderr_line1_has() { printf '%s\n' "$err" | head -n 1 | grep -qF -- "$1" || bad "stderr line 1 lacks: $1"; }

# expect_json <dotted.path> <substring>: stdout must be exactly one JSON object
# and the selected string field must contain the substring.
expect_json() {
  printf '%s' "$out" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let o;
      try { o = JSON.parse(s); } catch { process.exit(2); }
      if (!o || typeof o !== "object" || Array.isArray(o)) process.exit(2);
      const v = process.argv[1].split(".").reduce((a, k) => (a == null ? a : a[k]), o);
      process.exit(typeof v === "string" && v.includes(process.argv[2]) ? 0 : 1);
    });
  ' "$1" "$2"
  case $? in
    0) ;;
    2) bad "stdout is not exactly one JSON object" ;;
    *) bad "JSON $1 lacks: $2" ;;
  esac
}

expect_json_absent() { # top-level key must not exist
  printf '%s' "$out" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.exit(Object.hasOwn(JSON.parse(s), process.argv[1]) ? 1 : 0); } catch { process.exit(2); }
    });
  ' "$1" || bad "JSON has key $1 (or is not JSON)"
}

ctx() { # the additionalContext string, for line counting
  printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).hookSpecificOutput.additionalContext)}catch{}})'
}

stop() { env "$@" bash "$here/warn-uncommitted.sh"; }
lint() { CLAUDE_PROJECT_DIR="$1" bash "$here/lint-edited-file.sh"; }
payload() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }
# winpayload <path>: the path as the Write tool sends it on Windows, backslash
# separated and JSON-escaped. On Linux the hook's / conversion recovers the
# original path, so these cases run in CI too.
winpayload() {
  local p="${1//\//\\}"
  printf '{"tool_input":{"file_path":"%s"}}' "${p//\\/\\\\}"
}

# ---- fixtures ----------------------------------------------------------------
fx_git="$tmpd/git"
mkdir -p "$fx_git"
git -C "$fx_git" init -q
git -C "$fx_git" config commit.gpgsign false
git -C "$fx_git" -c user.name=t -c user.email=t@example.invalid commit --allow-empty -qm init

fx_nogit="$tmpd/nogit"
mkdir -p "$fx_nogit"

fx_lint="$tmpd/lint"
mkdir -p "$fx_lint/web/src"
printf 'export const a = 1;\n' > "$fx_lint/web/src/a.js"
install_stub() { # install_stub <body> [dir]
  local d="${2:-$fx_lint}"
  mkdir -p "$d/web/node_modules/.bin"
  printf '#!/usr/bin/env bash\n%s\n' "$1" > "$d/web/node_modules/.bin/eslint"
  chmod +x "$d/web/node_modules/.bin/eslint"
}
# findings_stub <mark> [dir]: one warning, message STUB-<mark>, filePath = the
# last argv, so a case can tell which tree's eslint ran and on what path.
findings_stub() {
  install_stub 'for a; do last="$a"; done
printf '"'"'[{"filePath":"%s","messages":[{"severity":1,"line":1,"column":1,"message":"STUB-'"$1"'","ruleId":"x"}]}]'"'"' "$last"
exit 1' "${2:-}"
}

# ---- warn-uncommitted.sh (Stop) ----------------------------------------------
# A missing or unset project dir must fail loudly, not exit 0 — the defect in
# #295 was a hook that cd-ed to a path off its own sandbox and reported success.
begin
run '' stop -u CLAUDE_CODE_REMOTE CLAUDE_PROJECT_DIR="$missing"
expect_exit 1; expect_stderr_has "CLAUDE_PROJECT_DIR unset or not a directory"; expect_stdout_empty
done_case "W1 warn-uncommitted: missing dir fails loudly"

begin
run '' stop -u CLAUDE_CODE_REMOTE -u CLAUDE_PROJECT_DIR
expect_exit 1; expect_stderr_has "<unset>"; expect_stdout_empty
done_case "W2 warn-uncommitted: unset var fails loudly"

# GIT_CEILING_DIRECTORIES stops git walking up into an enclosing repo, so the
# fixture really is "not a repo" wherever the temp dir lives. LC_ALL=C because
# git localises the message the second assertion looks for (#540).
begin
run '' stop -u CLAUDE_CODE_REMOTE CLAUDE_PROJECT_DIR="$fx_nogit" GIT_CEILING_DIRECTORIES="$tmpd" LC_ALL=C
expect_exit 1; expect_stderr_line1_is "[HOOK] warn-uncommitted: git status failed in $fx_nogit"; expect_stderr_has "not a git repository"; expect_stdout_empty
done_case "W3 warn-uncommitted: git failure is not read as clean"

# Dirty a fixture repo deliberately rather than assert against whatever state
# the working copy happens to be in.
: > "$fx_git/dirty"
dirty_stop() { # dirty_stop <stdin> <name>
  begin
  run "$1" stop -u CLAUDE_CODE_REMOTE CLAUDE_PROJECT_DIR="$fx_git"
  expect_exit 0
  expect_json systemMessage "file(s) changed and uncommitted"
  expect_json_absent decision; expect_json_absent continue; expect_json_absent hookSpecificOutput
  expect_stderr_empty
  done_case "$2"
}
dirty_stop '' "W4 warn-uncommitted: dirty tree -> systemMessage, turn not continued"

rm -f "$fx_git/dirty"
begin
run '' stop -u CLAUDE_CODE_REMOTE CLAUDE_PROJECT_DIR="$fx_git"
expect_exit 0; expect_stdout_empty; expect_stderr_empty
done_case "W5 warn-uncommitted: clean tree is silent"

: > "$fx_git/dirty"
begin
run '' stop CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$fx_git"
expect_exit 0; expect_stdout_empty; expect_stderr_empty
done_case "W6 warn-uncommitted: cloud session is silent on a dirty tree"

begin
run '' stop CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$missing"
expect_exit 0; expect_stdout_empty; expect_stderr_empty
done_case "W7 warn-uncommitted: cloud check runs before the dir check"

# stdin is deliberately not read (see the hook's header); these pin that.
dirty_stop '{"stop_hook_active":true}' "W8 warn-uncommitted: stop_hook_active does not suppress the warning"
dirty_stop 'not json' "W9 warn-uncommitted: malformed stdin does not matter"

# ---- lint-edited-file.sh (PostToolUse) ---------------------------------------
begin
run '{}' lint "$missing"
expect_exit 1; expect_stderr_has "CLAUDE_PROJECT_DIR unset or not a directory"; expect_stdout_empty
done_case "L1 lint: missing dir fails loudly"

begin
run 'not json at all' lint "$root"
expect_exit 1; expect_stderr_has "could not parse the hook payload"; expect_stdout_empty
done_case "L2 lint: unparseable payload fails loudly"

silent_lint() { # silent_lint <project-dir> <payload> <name>
  begin
  run "$2" lint "$1"
  expect_exit 0; expect_stdout_empty; expect_stderr_empty
  done_case "$3"
}
silent_lint "$root" '{"tool_input":{}}' "L3 lint: no file_path is a quiet no-op"
silent_lint "$root" "$(payload "$root/CLAUDE.md")" "L4 lint: non-JS file is a quiet no-op"
silent_lint "$root" "$(payload "$root/web/vite.config.js")" "L5 lint: JS outside src/ and scripts/ is a quiet no-op"
probe p_absent absent
silent_lint "$root" "$(payload "$p_absent")" "L6 lint: a file deleted before the lint is a quiet no-op"

# The scope check runs before the binary check, so an out-of-scope edit with no
# node_modules stays silent (pins the guard order).
printf 'export default {};\n' > "$fx_lint/web/vite.config.js"
silent_lint "$fx_lint" "$(payload "$fx_lint/web/vite.config.js")" "L16 lint: out-of-scope edit is silent even without eslint"

begin
run "$(payload "$fx_lint/web/src/a.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_has "eslint not installed"; expect_stdout_empty
done_case "L7 lint: missing eslint is visible"

install_stub 'printf "\nOops! Something went wrong! :(\n\nESLint: 10.14.0\n\nNo files matching the pattern \"x\" were found. CRASHPROBE\n" >&2; exit 2'
begin
run "$(payload "$fx_lint/web/src/a.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_line1_has "eslint failed to run (exit 2)"; expect_stderr_line1_has "CRASHPROBE"; expect_stdout_empty
done_case "L8 lint: eslint crash reads as a tooling failure"

install_stub 'echo "not json"; exit 1'
begin
run "$(payload "$fx_lint/web/src/a.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_has "could not read eslint output"; expect_stdout_empty
done_case "L9 lint: unreadable eslint output is a tooling failure"

# #536: the scope check compared the payload path to the root literally, so a
# backslash or drive-form difference on either side was a silent exit 0. Each
# positive case asserts a finding, because a miss would also exit 0.
findings_stub main
begin
run "$(winpayload "$fx_lint/web/src/a.js")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-main"
expect_json hookSpecificOutput.additionalContext "web/src/a.js:1:1"; expect_stderr_empty
done_case "L18 lint: backslash payload path is in scope"

mkdir -p "$fx_lint/web/scripts"
printf 'export const a = 1;\n' > "$fx_lint/web/scripts/a.mjs"
begin
run "$(payload "$fx_lint/web/scripts/a.mjs")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-main"
expect_json hookSpecificOutput.additionalContext "web/scripts/a.mjs:1:1"; expect_stderr_empty
done_case "L33 lint: an .mjs file under web/scripts is linted"

printf 'exports.a = 1;\n' > "$fx_lint/web/scripts/a.cjs"
begin
run "$(payload "$fx_lint/web/scripts/a.cjs")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-main"
expect_json hookSpecificOutput.additionalContext "web/scripts/a.cjs:1:1"; expect_stderr_empty
done_case "L34 lint: a .cjs file under web/scripts is linted"

fx_lint_win="${fx_lint//\//\\}\\"
begin
run "$(payload "$fx_lint/web/src/a.js")" lint "$fx_lint_win"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-main"
expect_json hookSpecificOutput.additionalContext "web/src/a.js:1:1"; expect_stderr_empty
done_case "L19 lint: backslash CLAUDE_PROJECT_DIR with a trailing \\ still lints"

fx_ws="$tmpd/Win Form"
mkdir -p "$fx_ws/web/src"
printf 'export const a = 1;\n' > "$fx_ws/web/src/a.js"
findings_stub ws "$fx_ws"
begin
run "$(winpayload "$fx_ws/web/src/a.js")" lint "${fx_ws//\//\\}"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-ws"
done_case "L20 lint: a path with a space, backslash on both sides"

# CLAUDE_PROJECT_DIR stays at the main checkout when a session is in a
# worktree, so the worktree is found from the file path, and its own eslint runs.
for w in wt1 wt2; do
  mkdir -p "$fx_lint/.claude/worktrees/$w/web/src"
  printf 'export const b = 1;\n' > "$fx_lint/.claude/worktrees/$w/web/src/b.js"
done
findings_stub wt1 "$fx_lint/.claude/worktrees/wt1"
begin
run "$(payload "$fx_lint/.claude/worktrees/wt1/web/src/b.js")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-wt1"
expect_json hookSpecificOutput.additionalContext "web/src/b.js:1:1"
case "$out" in *STUB-main*) bad "ran the main checkout's eslint, not the worktree's" ;; esac
done_case "L21 lint: a worktree file is linted with that worktree's eslint"

begin
run "$(payload "$fx_lint/.claude/worktrees/wt2/web/src/b.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_has "eslint not installed"; expect_stderr_has "worktrees/wt2"; expect_stdout_empty
done_case "L22 lint: a worktree without eslint is visible and named"

silent_lint "$fx_lint" "$(payload "$fx_lint/.claude/worktrees/wt1/web/vite.config.js")" "L23 lint: out-of-scope worktree file is a quiet no-op"

begin
run "$(payload "$tmpd/elsewhere/web/src/c.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_line1_has "outside"; expect_stdout_empty
done_case "L24 lint: web/src code outside the root is reported, not skipped"

# Stands in for a drive-form mismatch the key form does not reconcile: it must
# be loud, never a silent exit 0.
begin
run "$(payload "C:$fx_lint/web/src/a.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_line1_has "outside"; expect_stdout_empty
done_case "L25 lint: a drive mismatch is loud, not silent"

# Doubled separators collapse, in both the scope check and the path eslint gets.
begin
run "$(payload "$fx_lint/web//src/a.js")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-main"
expect_json hookSpecificOutput.additionalContext "web/src/a.js:1:1"
case "$out" in *web//src*) bad "eslint was handed the uncollapsed path" ;; esac
done_case "L27 lint: doubled separators in the main tree still lint"

begin
run "$(payload "$fx_lint/.claude//worktrees/wt1//web/src/b.js")" lint "$fx_lint"
expect_exit 0; expect_json hookSpecificOutput.additionalContext "STUB-wt1"
done_case "L28 lint: doubled separators in a worktree path still lint"

# A path under the root that misses scope only by letter case is a file Windows
# would open, so skipping it must be loud.
begin
run "$(payload "$fx_lint/web/Src/a.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_line1_has "only by letter case"; expect_stderr_has "web/Src/a.js"; expect_stdout_empty
done_case "L29 lint: in-root web/Src case variant is loud"

begin
run "$(payload "$fx_lint/.claude/Worktrees/wt1/web/src/b.js")" lint "$fx_lint"
expect_exit 1; expect_stderr_line1_has "only by letter case"; expect_stdout_empty
done_case "L30 lint: in-root .claude/Worktrees case variant is loud"

# Not every web/src under the root is a near miss: a nested package's must stay
# silent, or the guard would fire on vendored code.
silent_lint "$fx_lint" "$(payload "$fx_lint/.claude/worktrees/wt1/node_modules/pkg/web/src/x.js")" "L31 lint: a nested web/src below a worktree is a quiet no-op"

# The drive mapping cannot be reached end to end on Linux CI: a root has to pass
# -d, and no runner has /c/. So the hook's own fs_form and key_form are extracted
# by sed and unit-called. If the extraction ever breaks, key_form is undefined,
# every result is empty, and this case fails rather than passes.
begin
keys="$(
  eval "$(sed -n -e '/^fs_form() {$/,/^}$/p' -e '/^key_form() {$/,/^}$/p' "$here/lint-edited-file.sh")"
  key_form 'C:\x\web'; printf '|'; key_form 'c:/x/web'; printf '|'; key_form '/c/x/web'; printf '|'
  key_form '/c'; printf '|'; fs_form '\\srv\share\\x'
)"
[ "$keys" = 'C:/x/web|C:/x/web|C:/x/web|C:|//srv/share/x' ] || bad "key_form/fs_form gave: $keys"
done_case "L32 lint: C:\\x, c:/x and /c/x share one key; UNC // is kept"

if [ -x "$root/web/node_modules/.bin/eslint" ]; then
  utils="$root/web/src/utils"
  probe p_warn warn; probe p_err err; probe p_parse parse; probe p_many many; probe p_win win

  begin
  run "$(payload "$utils/formatting.js")" lint "$root"
  expect_exit 0; expect_stdout_empty; expect_stderr_empty
  done_case "L10 lint: clean file in web/src is silent"

  # no-unused-vars is a WARNING in web/eslint.config.js; it is reported only
  # because of --max-warnings=0. Its message contains ' and /^_/u, so parsing
  # the JSON also covers escaping.
  printf 'const unused = 1;\n' > "$p_warn"
  begin
  run "$(payload "$p_warn")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.hookEventName PostToolUse
  expect_json hookSpecificOutput.additionalContext "no-unused-vars"
  expect_json hookSpecificOutput.additionalContext "web/src/utils/${p_warn##*/}:1:7"
  expect_json hookSpecificOutput.additionalContext ":1:7 warning"
  expect_json_absent decision
  expect_stderr_empty
  done_case "L11 lint: warnings-only file reaches Claude as additionalContext"

  begin
  run "$(payload "$p_warn")" lint "$root/"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "no-unused-vars"
  done_case "L17 lint: trailing slash on CLAUDE_PROJECT_DIR still lints"

  printf 'undefinedFn();\n' > "$p_err"
  begin
  run "$(payload "$p_err")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "no-undef"
  expect_json hookSpecificOutput.additionalContext ":1:1 error"
  expect_json hookSpecificOutput.additionalContext ":1:1"
  done_case "L12 lint: error-severity finding is reported"

  printf 'const = ;\n' > "$p_parse"
  begin
  run "$(payload "$p_parse")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "parse-error"
  expect_json hookSpecificOutput.additionalContext "Parsing error"
  done_case "L13 lint: parse error is a finding, not a crash"

  for i in $(seq 1 30); do printf 'const u%s = 1;\n' "$i"; done > "$p_many"
  begin
  run "$(payload "$p_many")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "10 more problem(s) not shown"
  n="$(ctx | grep -c -F "${p_many##*/}:" || true)"
  [ "$n" = 20 ] || bad "expected 20 finding lines, got $n"
  len="$(ctx | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(s.length)))')"
  [ "$len" -le 4000 ] || bad "additionalContext is $len chars, cap is 4000"
  done_case "L14 lint: output is capped at 20 findings and 4000 chars"

  # A Windows payload escapes its separators; only a real JSON parse recovers
  # the path. If this regressed to string-munging, the path would not match
  # web/src/ and the case would pass as a silent no-op — so assert a finding.
  printf 'const unused = 1;\n' > "$p_warn"
  escaped="$(printf '%s' "$p_warn" | sed 's#/#\\/#g')"
  begin
  run "$(payload "$escaped")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "no-unused-vars"
  done_case "L15 lint: escaped payload path is JSON-parsed"

  printf 'const unused = 1;\n' > "$p_win"
  begin
  run "$(winpayload "$p_win")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "no-unused-vars"
  done_case "L26 lint: backslash payload through real eslint"

  # .mjs is outside the *.js|*.jsx case the hook used to match, so a miss here
  # is a silent exit 0 — the same shape as #564. no-unused-vars is an error on
  # scripts/*.mjs (the js/jsx block's warn override does not apply).
  p_mjs="$root/web/scripts/__hooktest_mjs_${tag}__.mjs"
  probes+=("$p_mjs")
  printf 'const unused = 1;\n' > "$p_mjs"
  begin
  run "$(payload "$p_mjs")" lint "$root"
  expect_exit 0
  expect_json hookSpecificOutput.additionalContext "no-unused-vars"
  expect_json hookSpecificOutput.additionalContext "web/scripts/${p_mjs##*/}:1:7"
  expect_json hookSpecificOutput.additionalContext ":1:7 error"
  expect_stderr_empty
  done_case "L35 lint: an .mjs unused binding is a finding"
else
  echo "skip  lint: eslint cases (run 'npm install' in web/)"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
