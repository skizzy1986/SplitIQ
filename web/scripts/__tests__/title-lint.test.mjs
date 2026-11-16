// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

// The naming rules in WORKFLOW.md §1 and §3 are enforced by two inline
// github-script steps. These tests run those scripts as they stand in the
// workflow files, so a rule cannot be edited there without this noticing.

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

// The body of the one `script: |` block in a workflow, dedented.
function scriptOf(workflowText) {
  const lines = workflowText.split('\n');
  const start = lines.findIndex((line) => /^\s*script: \|\s*$/.test(line));
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
