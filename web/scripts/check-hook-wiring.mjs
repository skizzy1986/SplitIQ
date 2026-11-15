// Checks that .claude/settings.json wires every hook script the way the repo
// expects.
//
// Why this exists (#541): the hook scripts had a smoke test, but the wiring
// that makes Claude Code run them did not. A settings-only change that
// detached a hook, renamed a matcher or broke the JSON passed CI silently, and
// a detached hook fails the way #295 did: nothing runs and nothing says so.
// EXPECTED_HOOKS is the record of what should be wired; this keeps the file
// honest against it, and flags a hook script that nothing wires.
//
// Exit codes: 0 OK; 1 wiring errors; 2 settings.json unreadable or not valid
// JSON, or the hooks directory unreadable.
//
//   npm run check:hooks
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');

const SETTINGS = '.claude/settings.json';
const HOOKS_DIR = '.claude/hooks';
const NOT_A_HOOK = ['test-hooks.sh'];

export const EXPECTED_HOOKS = [
  { event: 'SessionStart', matcher: null, script: 'session-start.sh' },
  { event: 'PreToolUse', matcher: 'Bash', script: 'block-secret-commit.sh' },
  {
    event: 'PostToolUse',
    matcher: 'Edit|Write',
    script: 'lint-edited-file.sh',
  },
  { event: 'Stop', matcher: null, script: 'warn-uncommitted.sh' },
];

export function commandFor(script) {
  return `bash "$CLAUDE_PROJECT_DIR/${HOOKS_DIR}/${script}"`;
}

export function parseSettings(text) {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`settings.json is not valid JSON: ${e.message}`, {
      cause: e,
    });
  }
}

const matcherOf = (entry) =>
  entry && typeof entry.matcher === 'string' && entry.matcher !== ''
    ? entry.matcher
    : null;
const show = (m) => (m === null ? 'no matcher' : `'${m}'`);
const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function checkWiring(settings, { exists, hookScripts }) {
  if (!isObject(settings) || !isObject(settings.hooks)) {
    return [`${SETTINGS} has no "hooks" object`];
  }
  const errors = [];
  const hooks = settings.hooks;
  const wired = new Set();
  const expectedEvents = new Set(EXPECTED_HOOKS.map((h) => h.event));

  for (const { event, matcher, script } of EXPECTED_HOOKS) {
    wired.add(script);
    const entries = hooks[event];
    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push(`${event}: event missing; expected a hook running ${script}`);
      continue;
    }
    const entry = entries.find((e) => matcherOf(e) === matcher);
    if (!entry) {
      const found = entries.map((e) => show(matcherOf(e))).join(', ');
      errors.push(
        `${event}: matcher must be ${show(matcher)} (found ${found}) for ${script}`
      );
    } else {
      const want = commandFor(script);
      const list = Array.isArray(entry.hooks) ? entry.hooks : [];
      const ok = list.some((h) => h?.type === 'command' && h.command === want);
      if (!ok) {
        const found = list.map((h) => JSON.stringify(h?.command)).join(', ');
        errors.push(
          `${event}: no command hook runs ${script}; expected ${JSON.stringify(want)}, found ${found || 'none'}`
        );
      } else {
        const copies = list.filter(
          (h) => h?.type === 'command' && h.command === want
        ).length;
        if (copies > 1) {
          errors.push(
            `${event}: ${script} is wired ${copies} times, so it runs ${copies} times; keep one`
          );
        }
        // Extras are only reported beside a correct hook; a wrong command is
        // already one error above, not two.
        for (const h of list) {
          if (!(h?.type === 'command' && h.command === want)) {
            errors.push(
              `${event}: hook ${JSON.stringify(h?.command ?? h)} not in EXPECTED_HOOKS; add it to the table`
            );
          }
        }
      }
      for (const e of entries) {
        if (e !== entry) {
          errors.push(
            `${event}: entry with ${show(matcherOf(e))} not in EXPECTED_HOOKS; add it to the table`
          );
        }
      }
    }
    if (!exists(join(repoRoot, HOOKS_DIR, script))) {
      errors.push(`${event}: hook script missing: ${HOOKS_DIR}/${script}`);
    }
  }

  for (const event of Object.keys(hooks)) {
    if (!expectedEvents.has(event)) {
      errors.push(`${event}: event not in EXPECTED_HOOKS; add it to the table`);
    }
  }

  for (const name of hookScripts) {
    if (!wired.has(name) && !NOT_A_HOOK.includes(name)) {
      errors.push(
        `orphan hook script: ${name}; wire it in EXPECTED_HOOKS or add it to NOT_A_HOOK`
      );
    }
  }
  return errors;
}

function main() {
  let settings;
  let hookScripts;
  try {
    settings = parseSettings(readFileSync(join(repoRoot, SETTINGS), 'utf8'));
    hookScripts = readdirSync(join(repoRoot, HOOKS_DIR)).filter((f) =>
      f.endsWith('.sh')
    );
  } catch (e) {
    console.error(`check:hooks: ${e.message}`);
    process.exit(2);
  }
  const errors = checkWiring(settings, { exists: existsSync, hookScripts });
  if (errors.length) {
    for (const msg of errors) console.log(`::error file=${SETTINGS}::${msg}`);
    console.error(`check:hooks: ${errors.length} wiring error(s)`);
    process.exit(1);
  }
  console.log(`hook wiring OK: ${EXPECTED_HOOKS.length} hooks`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
