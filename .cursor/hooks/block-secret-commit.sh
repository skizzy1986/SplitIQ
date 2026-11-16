#!/usr/bin/env bash
# Cursor beforeShellExecution adapter for the Claude secret-commit hook.
#
# .claude/hooks/block-secret-commit.sh is the check. It exits 2 when a
# secret-looking path is staged, and exits 0 with no stdout otherwise.
# A Cursor permission hook treats exit 0 plus output that is not the
# permission schema as a deny (https://cursor.com/docs/hooks), so calling
# the Claude script directly would block every shell command. This wrapper
# turns that silence into an allow. It does not reimplement the path pattern.
set -uo pipefail

root="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [ -z "$root" ] || [ ! -d "$root" ]; then
  root="$(pwd)"
fi
script="$root/.claude/hooks/block-secret-commit.sh"

input="$(cat)"

if [ ! -f "$script" ]; then
  printf '%s\n' '{"permission":"allow","agent_message":"Secret-commit hook missing at .claude/hooks/block-secret-commit.sh. Check staged files before committing."}'
  exit 0
fi

# The Claude script writes its block reason on stderr. Cursor needs a
# permission object on stdout. The sentence matches the script; the exit
# code is what decides. No second copy of the path pattern.
printf '%s' "$input" | bash "$script" >/dev/null 2>/dev/null
rc=$?

if [ "$rc" -eq 2 ]; then
  printf '%s\n' '{"permission":"deny","user_message":"BLOCKED: a secret-looking file is staged. Unstage it before committing.","agent_message":"BLOCKED: a secret-looking file is staged. Unstage it before committing."}'
  exit 2
fi

if [ "$rc" -ne 0 ]; then
  printf '%s\n' '{"permission":"allow","agent_message":"Secret-commit hook failed open. Check staged files before committing."}'
  exit 0
fi

printf '%s\n' '{"permission":"allow"}'
exit 0
