// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_HOOKS,
  checkWiring,
  commandFor,
  parseSettings,
} from '../check-hook-wiring.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const repoRoot = resolve(webRoot, '..');
const scriptPath = join(webRoot, 'scripts/check-hook-wiring.mjs');
const settingsText = readFileSync(
  join(repoRoot, '.claude/settings.json'),
  'utf8'
);
const realScripts = readdirSync(join(repoRoot, '.claude/hooks')).filter((f) =>
  f.endsWith('.sh')
);

const SCRIPTS = [...EXPECTED_HOOKS.map((h) => h.script), 'test-hooks.sh'];

function goodSettings() {
  const hooks = {};
  for (const { event, matcher, script } of EXPECTED_HOOKS) {
    const entry = { hooks: [{ type: 'command', command: commandFor(script) }] };
    if (matcher) entry.matcher = matcher;
    hooks[event] = [entry];
  }
  return { permissions: {}, hooks };
}

const deps = (over = {}) => ({
  exists: () => true,
  hookScripts: SCRIPTS,
  ...over,
});

describe('check-hook-wiring', () => {
  it('T0 the fixture builder is itself clean', () => {
    expect(checkWiring(goodSettings(), deps())).toEqual([]);
  });

  it('T1 the real settings.json is wired as expected', () => {
    const errors = checkWiring(parseSettings(settingsText), {
      exists: existsSync,
      hookScripts: realScripts,
    });
    expect(errors).toEqual([]);
  });

  it('T2 BOM-prefixed and BOM-less text parse the same', () => {
    const body = JSON.stringify(goodSettings());
    expect(parseSettings(`\uFEFF${body}`)).toEqual(parseSettings(body));
  });

  it('T3 truncated JSON throws "not valid JSON"', () => {
    expect(() => parseSettings('{"hooks": {')).toThrow(
      /settings\.json is not valid JSON/
    );
  });

  it('T4 a removed Stop hook names the event and the script', () => {
    const s = goodSettings();
    delete s.hooks.Stop;
    const errors = checkWiring(s, deps());
    // One error, not a second "orphan" for the same script: it is in the table.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Stop: .*warn-uncommitted\.sh/);
  });

  it('T5 a reordered matcher is reported with the value found', () => {
    const s = goodSettings();
    s.hooks.PostToolUse[0].matcher = 'Write|Edit';
    const errors = checkWiring(s, deps());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "PostToolUse: matcher must be 'Edit|Write' (found 'Write|Edit')"
    );
  });

  it('T6 a relative command shows the expected and found strings', () => {
    const s = goodSettings();
    s.hooks.PreToolUse[0].hooks[0].command =
      'bash .claude/hooks/block-secret-commit.sh';
    const errors = checkWiring(s, deps());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^PreToolUse: /);
    expect(errors[0]).toContain(
      JSON.stringify(commandFor('block-secret-commit.sh'))
    );
    expect(errors[0]).toContain('"bash .claude/hooks/block-secret-commit.sh"');
  });

  it('T7 a missing script file is reported', () => {
    const errors = checkWiring(
      goodSettings(),
      deps({ exists: (p) => !p.endsWith('lint-edited-file.sh') })
    );
    expect(errors).toEqual([
      'PostToolUse: hook script missing: .claude/hooks/lint-edited-file.sh',
    ]);
  });

  it('T8 an extra event, entry or hook is "not in EXPECTED_HOOKS"', () => {
    const s = goodSettings();
    s.hooks.Notification = [
      { hooks: [{ type: 'command', command: 'bash x.sh' }] },
    ];
    s.hooks.PreToolUse.push({
      matcher: 'Read',
      hooks: [
        { type: 'command', command: commandFor('block-secret-commit.sh') },
      ],
    });
    s.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo hi' });
    const errors = checkWiring(s, deps());
    expect(errors).toHaveLength(3);
    for (const e of errors) expect(e).toContain('not in EXPECTED_HOOKS');
    expect(errors.some((e) => e.startsWith('Notification:'))).toBe(true);
    expect(
      errors.some((e) => e.startsWith("PreToolUse: entry with 'Read'"))
    ).toBe(true);
    expect(errors.some((e) => e.startsWith('Stop: hook "echo hi"'))).toBe(true);
  });

  it('T9 an unwired script is an orphan; test-hooks.sh never is', () => {
    const errors = checkWiring(
      goodSettings(),
      deps({ hookScripts: [...SCRIPTS, 'foo.sh'] })
    );
    expect(errors).toEqual([
      'orphan hook script: foo.sh; wire it in EXPECTED_HOOKS or add it to NOT_A_HOOK',
    ]);
  });

  it('T12 a correct hook wired twice is reported once', () => {
    const s = goodSettings();
    s.hooks.Stop[0].hooks.push({
      type: 'command',
      command: commandFor('warn-uncommitted.sh'),
    });
    expect(checkWiring(s, deps())).toEqual([
      'Stop: warn-uncommitted.sh is wired 2 times, so it runs 2 times; keep one',
    ]);
  });

  it('T10 a missing hooks key is one structural error', () => {
    const errors = checkWiring({ permissions: {} }, deps());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no "hooks" object');
  });

  it('T11 the CLI passes on the real repo', () => {
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out).toContain('hook wiring OK');
  });
});
