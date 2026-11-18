// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

// The naming and PR type-label rules in the private workflow doc §1 and §3 are enforced by
// three inline github-script steps. These tests run those scripts as they
// stand in the workflow files, so a rule cannot be edited there without this
// noticing.

const here = dirname(fileURLToPath(import.meta.url));
const workflows = resolve(here, '../../../.github/workflows');
const prWorkflow = readFileSync(
  resolve(workflows, 'pr-title-lint.yml'),
  'utf8'
);
const issueWorkflow = readFileSync(
  resolve(workflows, 'issue-title-lint.yml'),
  'utf8'
);

// The body of the first `script: |` block in a workflow, dedented. With
// `after`, the first block after the first line matching that RegExp, so a
// workflow with several github-script steps can be read step by step.
function scriptOf(workflowText, after) {
  const lines = workflowText.split('\n');
  let from = 0;
  if (after) {
    from = lines.findIndex((line) => after.test(line));
    if (from === -1) throw new Error(`no line matching ${after} found`);
  }
  const start = lines.findIndex(
    (line, i) => i >= from && /^\s*script: \|\s*$/.test(line)
  );
  if (start === -1) throw new Error('no `script: |` block found');
  const indent = lines[start].match(/^\s*/)[0].length + 2;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

const AsyncFunction = (async () => {}).constructor;
const prScript = new AsyncFunction('github', 'context', scriptOf(prWorkflow));
const issueScript = new AsyncFunction(
  'github',
  'context',
  scriptOf(issueWorkflow)
);

// What #<n> is in the fake repo: 567 an issue, 590 a pull request, the rest
// nothing at all.
function fakeGithub() {
  const get = vi.fn(async ({ issue_number: n }) => {
    if (n === 567) return { data: { number: 567 } };
    if (n === 590) return { data: { number: 590, pull_request: {} } };
    throw Object.assign(new Error('Not Found'), { status: 404 });
  });
  return { rest: { issues: { get } } };
}

function lintPr(title, { number = 600, login = 'skizzy1986', github } = {}) {
  return prScript(github ?? fakeGithub(), {
    repo: { owner: 'skizzy1986', repo: 'SplitIQ' },
    payload: { pull_request: { title, number, user: { login } } },
  });
}

function lintIssue(title, overrides = {}) {
  return issueScript(
    {},
    {
      payload: {
        action: 'opened',
        issue: { title, user: { type: 'User' }, labels: [] },
        ...overrides,
      },
    }
  );
}

describe('PR title ends with its issue number', () => {
  it('passes a title that ends with an existing issue', async () => {
    const github = fakeGithub();
    await expect(
      lintPr('fix(strength): keep logger sheets inside the window (#567)', {
        github,
      })
    ).resolves.toBeUndefined();
    expect(github.rest.issues.get).toHaveBeenCalledWith({
      owner: 'skizzy1986',
      repo: 'SplitIQ',
      issue_number: 567,
    });
  });

  it.each([
    ['no number at all', 'feat(coherence): unify navigation and themes'],
    ['the number in the middle', 'fix(hooks): #567 follow-ups — wiring check'],
    ['a roadmap id beside it', 'refactor(squat): movement config (R12, #567)'],
    ['a range', 'fix(hooks): follow-ups (#537–#541)'],
    ['text after it', 'fix(strength): keep sheets inside (#567) again'],
    ['no space before it', 'fix(strength): keep sheets inside(#567)'],
    ['only the number', '(#567)'],
  ])('fails %s', async (_name, title) => {
    await expect(lintPr(title)).rejects.toThrow(
      /does not end with " \(#<issue>\)"/
    );
  });

  it("fails the pull request's own number", async () => {
    await expect(
      lintPr('fix(strength): keep sheets inside (#567)', { number: 567 })
    ).rejects.toThrow(/this pull request's own number/);
  });

  it('fails a number that belongs to a pull request', async () => {
    await expect(
      lintPr('fix(strength): keep sheets inside (#590)')
    ).rejects.toThrow(/#590 is a pull request, not an issue/);
  });

  it('fails a number that does not exist', async () => {
    await expect(
      lintPr('fix(strength): keep sheets inside (#9999)')
    ).rejects.toThrow(/#9999 is not an issue in this repository/);
  });

  // A typed PR number after the issue number: the last bracket is the one
  // that is checked, and it is not an issue.
  it('fails a hand-typed PR number after the issue number', async () => {
    await expect(
      lintPr('fix(strength): keep sheets inside (#567) (#590)')
    ).rejects.toThrow(/#590 is a pull request/);
  });

  it('does not turn an API outage into a naming error', async () => {
    const github = fakeGithub();
    github.rest.issues.get.mockRejectedValue(
      Object.assign(new Error('Server Error'), { status: 500 })
    );
    await expect(
      lintPr('fix(strength): keep sheets inside (#567)', { github })
    ).rejects.toThrow('Server Error');
  });

  it('exempts Dependabot, which has no issue, without calling the API', async () => {
    const github = fakeGithub();
    await expect(
      lintPr('build(deps): bump vite from 7.1.0 to 7.1.1', {
        login: 'dependabot[bot]',
        github,
      })
    ).resolves.toBeUndefined();
    expect(github.rest.issues.get).not.toHaveBeenCalled();
  });
});

describe('issue title has no type prefix', () => {
  it.each([
    'Logger sheets are cut off at the window bottom on desktop',
    'When this ships, Scott can type `/handover` to move a task',
    'Epic: product coherence — one SplitIQ for coaches',
    'Fix the pace rounding on the erg summary',
    'Docs and onboarding: say who runs the gates',
  ])('passes "%s"', async (title) => {
    await expect(lintIssue(title)).resolves.toBeUndefined();
  });

  it.each([
    'fix(squat): rail footer drops below the fold',
    'feat: date picker for the log form',
    'ci: `web/e2e/` is not linted',
    'Docs: one claim per issue',
    'refactor!: move StrengthLogger into views/',
    'chore(supabase): backfill migration files',
  ])('fails "%s"', async (title) => {
    await expect(lintIssue(title)).rejects.toThrow(/starts with a type prefix/);
  });

  it('ignores an edit that did not change the title', async () => {
    await expect(
      lintIssue('fix(squat): rail footer drops below the fold', {
        action: 'edited',
        changes: { body: { from: 'old' } },
      })
    ).resolves.toBeUndefined();
  });

  it('checks an edit that did change the title', async () => {
    await expect(
      lintIssue('fix(squat): rail footer drops below the fold', {
        action: 'edited',
        changes: { title: { from: 'Rail footer drops below the fold' } },
      })
    ).rejects.toThrow(/starts with a type prefix/);
  });

  it('leaves bot-filed and Routine-owned issues alone', async () => {
    const title = 'chore(doctrine): supersede doctrine_sha to latest main';
    await expect(
      lintIssue(title, { issue: { title, user: { type: 'Bot' }, labels: [] } })
    ).resolves.toBeUndefined();
    await expect(
      lintIssue(title, {
        issue: {
          title,
          user: { type: 'User' },
          labels: [{ name: 'routine-managed' }],
        },
      })
    ).resolves.toBeUndefined();
  });

  it('uses the same type list as the PR title check', () => {
    const prTypes = prWorkflow
      .match(/types: \|\n((?:\s+[a-z]+\n)+)/)[1]
      .trim()
      .split(/\s+/);
    const issueTypes = scriptOf(issueWorkflow)
      .match(/const TYPES = \[([^\]]+)\]/)[1]
      .match(/[a-z]+/g);
    expect(issueTypes).toEqual(prTypes);
  });
});

describe('PR type label follows the title type', () => {
  const repoRoot = resolve(here, '../../..');
  // CRLF-normalised: a Windows checkout must not break the `^…$` anchors.
  const readWorkflow = (name) =>
    readFileSync(resolve(workflows, name), 'utf8').replace(/\r\n/g, '\n');
  const labelerWorkflow = readWorkflow('labeler.yml');
  const TYPE_STEP = /name: Set the type label from the title/;
  const typeScriptText = scriptOf(labelerWorkflow, TYPE_STEP);
  const typeScript = new AsyncFunction('github', 'context', typeScriptText);
  // The mapping as the workflow declares it: its object literal, evaluated.
  const TYPE_LABELS = new Function(
    `return ${typeScriptText.match(/const TYPE_LABELS = (\{[^}]*\});/)[1]}`
  )();

  function fakeLabels(names = []) {
    const listLabelsOnIssue = vi.fn(async () => ({
      data: names.map((name) => ({ name })),
    }));
    const addLabels = vi.fn(async () => ({ data: [] }));
    const removeLabel = vi.fn(async () => ({ data: [] }));
    return { rest: { issues: { listLabelsOnIssue, addLabels, removeLabel } } };
  }

  function labelPr(
    title,
    { github = fakeLabels(), number = 600, login = 'skizzy1986' } = {}
  ) {
    return typeScript(github, {
      repo: { owner: 'skizzy1986', repo: 'SplitIQ' },
      payload: { pull_request: { title, number, user: { login } } },
    });
  }

  const repo = { owner: 'skizzy1986', repo: 'SplitIQ', issue_number: 600 };
  const removed = (github) =>
    github.rest.issues.removeLabel.mock.calls.map(([args]) => args.name);
  const serverError = () =>
    Object.assign(new Error('Server Error'), { status: 500 });

  it.each([
    ['feat', 'type: feature'],
    ['fix', 'type: bug'],
    ['revert', 'type: bug'],
    ['docs', 'type: docs'],
    ['refactor', 'type: refactor'],
    ['perf', 'type: refactor'],
    ['test', 'type: chore'],
    ['ci', 'type: chore'],
    ['build', 'type: chore'],
    ['chore', 'type: chore'],
    ['style', 'type: chore'],
    ['config', 'type: chore'],
    ['housekeeping', 'type: chore'],
  ])('labels a %s title "%s"', async (type, label) => {
    const github = fakeLabels();
    await labelPr(`${type}: x (#567)`, { github });
    expect(github.rest.issues.listLabelsOnIssue).toHaveBeenCalledWith({
      ...repo,
      per_page: 100,
    });
    expect(github.rest.issues.addLabels).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      ...repo,
      labels: [label],
    });
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it.each([
    ['a scope', 'fix(strength): x (#567)', 'type: bug'],
    ['a breaking marker', 'feat!: x', 'type: feature'],
    ['a scope and a breaking marker', 'refactor(squat)!: x', 'type: refactor'],
  ])('reads the type through %s', async (_name, title, label) => {
    const github = fakeLabels();
    await labelPr(title, { github });
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      ...repo,
      labels: [label],
    });
  });

  it.each([
    ['a capitalised type', 'Feat: x'],
    ['an unknown type', 'wip: x'],
    ['a plain sentence', 'Keep logger sheets inside the window'],
    ['a GitHub revert title', 'Revert "feat: x"'],
    ['an Object.prototype name', 'constructor: x'],
    ['a prototype key', '__proto__: x'],
    ['no space after the colon', 'feat:x'],
  ])('makes no API call for %s', async (_name, title) => {
    const github = fakeLabels(['type: docs']);
    await expect(labelPr(title, { github })).resolves.toBeUndefined();
    expect(github.rest.issues.listLabelsOnIssue).not.toHaveBeenCalled();
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('only reads when the label is already right', async () => {
    const github = fakeLabels(['type: feature', 'area: anatomy']);
    await labelPr('feat: x (#567)', { github });
    expect(github.rest.issues.listLabelsOnIssue).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('removes a stale type label beside the right one, without adding', async () => {
    const github = fakeLabels(['type: feature', 'type: docs']);
    await labelPr('feat: x (#567)', { github });
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).toHaveBeenCalledWith({
      ...repo,
      name: 'type: docs',
    });
    expect(removed(github)).toEqual(['type: docs']);
  });

  it('adds the right label first, then removes every other type label', async () => {
    const github = fakeLabels(['type: bug', 'type: docs']);
    const order = [];
    github.rest.issues.addLabels.mockImplementation(async ({ labels }) => {
      order.push(`add ${labels[0]}`);
    });
    github.rest.issues.removeLabel.mockImplementation(async ({ name }) => {
      order.push(`remove ${name}`);
    });
    await labelPr('feat: x (#567)', { github });
    expect(order).toEqual([
      'add type: feature',
      'remove type: bug',
      'remove type: docs',
    ]);
  });

  it('never removes a label that is not a type label', async () => {
    const github = fakeLabels([
      'type: bug',
      'area: anatomy',
      'epic: 432 roadmap',
      'P2',
      'dependencies',
    ]);
    await labelPr('feat: x (#567)', { github });
    expect(removed(github)).toEqual(['type: bug']);
  });

  it('removes type: epic and type: spike from a pull request', async () => {
    const github = fakeLabels(['type: epic', 'type: spike']);
    await labelPr('feat: x (#567)', { github });
    expect(removed(github)).toEqual(['type: epic', 'type: spike']);
  });

  it('treats a label that is already gone (404) as removed', async () => {
    const github = fakeLabels(['type: docs']);
    github.rest.issues.removeLabel.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    );
    await expect(
      labelPr('feat: x (#567)', { github })
    ).resolves.toBeUndefined();
  });

  it('surfaces any other removeLabel failure', async () => {
    const github = fakeLabels(['type: docs']);
    github.rest.issues.removeLabel.mockRejectedValue(serverError());
    await expect(labelPr('feat: x (#567)', { github })).rejects.toThrow(
      'Server Error'
    );
  });

  it('removes nothing when adding the right label fails', async () => {
    const github = fakeLabels(['type: docs']);
    github.rest.issues.addLabels.mockRejectedValue(serverError());
    await expect(labelPr('feat: x (#567)', { github })).rejects.toThrow(
      'Server Error'
    );
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('surfaces a failure to read the current labels', async () => {
    const github = fakeLabels();
    github.rest.issues.listLabelsOnIssue.mockRejectedValue(serverError());
    await expect(labelPr('feat: x (#567)', { github })).rejects.toThrow(
      'Server Error'
    );
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  it.each([
    'chore(deps): bump vite from 7.1.0 to 7.1.1',
    'build(deps): bump vite from 7.1.0 to 7.1.1',
  ])('labels Dependabot\'s "%s" as chore', async (title) => {
    const github = fakeLabels();
    await labelPr(title, { github, login: 'dependabot[bot]' });
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      ...repo,
      labels: ['type: chore'],
    });
  });

  it('maps only to type labels that exist, never epic or spike', () => {
    const labelsYml = readFileSync(
      resolve(repoRoot, '.github/labels.yml'),
      'utf8'
    );
    const typeNames = [
      ...labelsYml.matchAll(/^- name: '(type: [a-z]+)'/gm),
    ].map((m) => m[1]);
    expect(typeNames).toContain('type: feature');
    const values = Object.values(TYPE_LABELS);
    for (const label of values) expect(typeNames).toContain(label);
    expect(values).not.toContain('type: epic');
    expect(values).not.toContain('type: spike');
  });

  it('maps every type the PR title check allows, and no other', () => {
    const prTypes = prWorkflow
      .match(/types: \|\n((?:\s+[a-z]+\n)+)/)[1]
      .trim()
      .split(/\s+/);
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...prTypes].sort());
  });

  it('keeps type labels out of the path labeler, which would strip them', () => {
    const labelerYml = readFileSync(
      resolve(repoRoot, '.github/labeler.yml'),
      'utf8'
    );
    expect(labelerYml).not.toMatch(/^['"]?type: /m);
  });

  // #605: the type step lives in labeler.yml's `label` job, after the path
  // labeler and serialised with it, so labeler's snapshot-then-PUT can never
  // resurrect or drop a type label written by a concurrent run.
  describe('runs after the path labeler, in one serialised job (#605)', () => {
    // A top-level job: from `  <id>:` to the next top-level job or EOF.
    function jobBlock(text, id) {
      const lines = text.split('\n');
      const start = lines.findIndex((line) => line === `  ${id}:`);
      if (start === -1) throw new Error(`no job ${id} found`);
      const end = lines.findIndex(
        (line, i) => i > start && /^ {2}[a-z-]+:$/.test(line)
      );
      return lines.slice(start, end === -1 ? undefined : end).join('\n');
    }
    const labelJob = jobBlock(labelerWorkflow, 'label');

    it('anchors to the type script, not the staleness script', () => {
      expect(typeScriptText).toContain('const TYPE_LABELS');
      expect(typeScriptText).not.toContain('steward-staleness');
    });

    it('has one home: pr-type-label.yml is gone, only labeler.yml maps types', () => {
      expect(existsSync(resolve(workflows, 'pr-type-label.yml'))).toBe(false);
      const mapping = readdirSync(workflows)
        .filter((name) => name.endsWith('.yml'))
        .filter((name) => /const TYPE_LABELS/.test(readWorkflow(name)));
      expect(mapping).toEqual(['labeler.yml']);
    });

    it('triggers on every event that can change the title or the paths', () => {
      expect(labelerWorkflow).toMatch(
        /^on:\n {2}pull_request_target:\n {4}types: \[opened, edited, synchronize, reopened\]$/m
      );
    });

    it('serialises the label job per PR without cancelling', () => {
      expect(labelJob).toMatch(
        /^ {4}concurrency:\n {6}group: pr-labels-\$\{\{ github\.event\.pull_request\.number \}\}\n {6}cancel-in-progress: false$/m
      );
    });

    it('runs the type step after the path labeler', () => {
      const labeler = labelJob.indexOf('uses: actions/labeler@');
      expect(labeler).toBeGreaterThanOrEqual(0);
      expect(labeler).toBeLessThan(
        labelJob.indexOf('name: Set the type label from the title')
      );
      expect(labelJob).toContain('sync-labels: true');
    });

    it('keeps the type step advisory and running after a labeler failure', () => {
      const from = labelJob.indexOf('name: Set the type label from the title');
      const next = labelJob.indexOf('\n      - ', from);
      const step = labelJob.slice(from, next === -1 ? undefined : next);
      expect(step).toContain('continue-on-error: true');
      expect(step).toContain('if: ${{ !cancelled() }}');
    });

    it('never checks out PR code under pull_request_target', () => {
      expect(labelerWorkflow).not.toMatch(/actions\/checkout/);
    });

    // The steward-staleness job left with the steward skill (#674).
    it('has no steward-staleness job', () => {
      expect(() => jobBlock(labelerWorkflow, 'steward-staleness')).toThrow();
    });
  });
});
