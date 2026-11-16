// @vitest-environment node
import { URL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  EPIC_TYPE_LABEL,
  epicLabelName,
  githubApi,
  issueNumberFromTitle,
  plan,
  reconcile,
} from '../epic-labels.mjs';

// An in-memory repository that answers the same questions the REST API does.
function fakeRepo({ labels = [], issues = [], pulls = [], parents = {} }) {
  const repoLabels = labels.map((name) => ({ name, color: 'abcdef' }));
  const items = new Map();
  for (const issue of issues) {
    items.set(issue.number, { state: 'open', labels: [], ...issue });
  }
  for (const pull of pulls) {
    items.set(pull.number, {
      state: 'open',
      labels: [],
      pull_request: {},
      ...pull,
    });
  }
  const shape = (item) => ({
    ...item,
    labels: item.labels.map((name) => ({ name })),
    sub_issues_summary: {
      total: Object.values(parents).filter((p) => p === item.number).length,
    },
  });
  const writes = [];
  const api = {
    listLabels: async () => repoLabels.map((l) => ({ ...l })),
    listOpenEpics: async () =>
      [...items.values()]
        .filter((i) => i.state === 'open' && i.labels.includes(EPIC_TYPE_LABEL))
        .map(shape),
    listSubIssues: vi.fn(async (number) =>
      Object.entries(parents)
        .filter(([, parent]) => parent === number)
        .map(([child]) => shape(items.get(Number(child))))
    ),
    listOpenPulls: async () =>
      [...items.values()]
        .filter((i) => i.pull_request && i.state === 'open')
        .map(shape),
    listLabelled: async (name) =>
      [...items.values()].filter((i) => i.labels.includes(name)).map(shape),
    createLabel: async (label) => {
      writes.push(['create', label.name]);
      repoLabels.push(label);
    },
    addLabel: async (number, name) => {
      writes.push(['add', number, name]);
      items.get(number).labels.push(name);
    },
    removeLabel: async (number, name) => {
      writes.push(['remove', number, name]);
      const item = items.get(number);
      item.labels = item.labels.filter((l) => l !== name);
    },
  };
  return { api, writes, labelsOf: (n) => items.get(n).labels };
}

const ROADMAP = 'epic: 432 roadmap';

function roadmapRepo(extra = {}) {
  return fakeRepo({
    labels: [EPIC_TYPE_LABEL, ROADMAP, 'P1'],
    issues: [
      { number: 432, labels: [EPIC_TYPE_LABEL, 'P1'] },
      { number: 437 },
      { number: 441, state: 'closed' },
      { number: 600 },
      ...(extra.issues ?? []),
    ],
    pulls: extra.pulls ?? [],
    parents: { 437: 432, 441: 432, ...(extra.parents ?? {}) },
    ...(extra.labels ? { labels: extra.labels } : {}),
  });
}

describe('issueNumberFromTitle', () => {
  it('reads the number in the last bracket', () => {
    expect(issueNumberFromTitle('feat(squat): charts (#437)')).toBe(437);
  });

  it.each(['feat(squat): charts', 'fix: #437 follow-ups', '(#437)', undefined])(
    'is null for %s',
    (title) => {
      expect(issueNumberFromTitle(title)).toBeNull();
    }
  );
});

describe('epicLabelName', () => {
  it('prefers the named label over the bare fallback', () => {
    expect(epicLabelName(['epic: 432', ROADMAP, 'epic: 4321 other'], 432)).toBe(
      ROADMAP
    );
  });

  it('falls back to the bare label, and to null when there is none', () => {
    expect(epicLabelName(['epic: 432', EPIC_TYPE_LABEL], 432)).toBe(
      'epic: 432'
    );
    expect(epicLabelName([EPIC_TYPE_LABEL, 'epic: 4321 x'], 432)).toBeNull();
  });
});

describe('reconcile', () => {
  it('labels every sub-issue of an epic, open or closed, and not the epic', async () => {
    const { api, writes, labelsOf } = roadmapRepo();
    await reconcile(api);
    expect(writes).toEqual([
      ['add', 437, ROADMAP],
      ['add', 441, ROADMAP],
    ]);
    expect(labelsOf(432)).not.toContain(ROADMAP);
    expect(labelsOf(600)).toEqual([]);
  });

  it('makes no writes when nothing has changed', async () => {
    const { api, writes } = roadmapRepo();
    await reconcile(api);
    writes.length = 0;
    const changes = await reconcile(api);
    expect(writes).toEqual([]);
    expect(changes).toEqual({ create: [], add: [], remove: [] });
  });

  it('labels an open PR whose title names a sub-issue, or the epic itself', async () => {
    const { api, labelsOf } = roadmapRepo({
      pulls: [
        { number: 700, title: 'feat(squat): charts (#437)' },
        { number: 701, title: 'docs(roadmap): H1 status (#432)' },
        { number: 702, title: 'fix(strength): sheets (#600)' },
        { number: 703, title: 'feat(squat): no issue number' },
      ],
    });
    await reconcile(api);
    expect(labelsOf(700)).toEqual([ROADMAP]);
    expect(labelsOf(701)).toEqual([ROADMAP]);
    expect(labelsOf(702)).toEqual([]);
    expect(labelsOf(703)).toEqual([]);
  });

  it('follows sub-issues of sub-issues', async () => {
    const { api, labelsOf } = roadmapRepo({
      issues: [{ number: 610 }],
      parents: { 610: 437 },
    });
    await reconcile(api);
    expect(labelsOf(610)).toEqual([ROADMAP]);
  });

  it('gives a nested epic the outer label and its descendants its own', async () => {
    const SQUAT = 'epic: 382 squat v1';
    const { api, labelsOf } = roadmapRepo({
      labels: [EPIC_TYPE_LABEL, ROADMAP, SQUAT],
      issues: [{ number: 382, labels: [EPIC_TYPE_LABEL] }, { number: 620 }],
      parents: { 382: 432, 620: 382 },
    });
    await reconcile(api);
    expect(labelsOf(382)).toEqual([EPIC_TYPE_LABEL, ROADMAP]);
    expect(labelsOf(620)).toEqual([SQUAT]);
  });

  it('removes the label from an issue that left the epic or got it by hand', async () => {
    const { api, writes, labelsOf } = roadmapRepo({
      issues: [{ number: 630, labels: [ROADMAP, 'P1'] }],
    });
    await reconcile(api);
    expect(writes).toContainEqual(['remove', 630, ROADMAP]);
    expect(labelsOf(630)).toEqual(['P1']);
  });

  it('removes it from an open PR retitled to another issue, and leaves a closed PR', async () => {
    const { api, labelsOf } = roadmapRepo({
      pulls: [
        { number: 710, title: 'fix: sheets (#600)', labels: [ROADMAP] },
        {
          number: 711,
          title: 'feat(squat): charts',
          labels: [ROADMAP],
          state: 'closed',
        },
      ],
    });
    await reconcile(api);
    expect(labelsOf(710)).toEqual([]);
    expect(labelsOf(711)).toEqual([ROADMAP]);
  });

  it('creates a fallback label for an epic that has none, before using it', async () => {
    const { api, writes } = roadmapRepo({ labels: [EPIC_TYPE_LABEL] });
    const changes = await reconcile(api);
    expect(writes).toEqual([
      ['create', 'epic: 432'],
      ['add', 437, 'epic: 432'],
      ['add', 441, 'epic: 432'],
    ]);
    expect(changes.create[0]).toMatchObject({ color: 'abcdef' });
    expect(changes.create[0].description.length).toBeLessThanOrEqual(100);
  });

  it('ignores a closed epic and leaves the labels its work already carries', async () => {
    const { api, writes } = fakeRepo({
      labels: [EPIC_TYPE_LABEL, ROADMAP],
      issues: [
        { number: 432, labels: [EPIC_TYPE_LABEL], state: 'closed' },
        { number: 437, labels: [ROADMAP] },
      ],
      parents: { 437: 432 },
    });
    await reconcile(api);
    expect(writes).toEqual([]);
  });

  it('writes nothing on a dry run but reports the same plan', async () => {
    const { api, writes } = roadmapRepo();
    const lines = [];
    const changes = await reconcile(api, {
      dryRun: true,
      log: (line) => lines.push(line),
    });
    expect(writes).toEqual([]);
    expect(changes).toEqual(await plan(api));
    expect(lines).toEqual([`#437: add "${ROADMAP}"`, `#441: add "${ROADMAP}"`]);
  });
});

describe('githubApi', () => {
  function fakeFetch(pages) {
    return vi.fn(async (url, init) => {
      const page = Number(new URL(url).searchParams.get('page') ?? 1);
      const body = init.method === 'GET' ? (pages[page - 1] ?? []) : {};
      return { ok: true, status: 200, json: async () => body };
    });
  }
  const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));

  it('reads every page of a list', async () => {
    const fetch = fakeFetch([full, [{ number: 101 }]]);
    const api = githubApi({ token: 't', repo: 'o/r', fetch });
    expect(await api.listSubIssues(432)).toHaveLength(101);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/o/r/issues/432/sub_issues?per_page=100&page=1',
      'https://api.github.com/repos/o/r/issues/432/sub_issues?per_page=100&page=2',
    ]);
  });

  it('encodes label names in queries and paths', async () => {
    const fetch = fakeFetch([[]]);
    const api = githubApi({ token: 't', repo: 'o/r', fetch });
    await api.listOpenEpics();
    await api.removeLabel(437, ROADMAP);
    expect(fetch.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      [
        'GET',
        'https://api.github.com/repos/o/r/issues?state=open&labels=type%3A%20epic&per_page=100&page=1',
      ],
      [
        'DELETE',
        'https://api.github.com/repos/o/r/issues/437/labels/epic%3A%20432%20roadmap',
      ],
    ]);
  });

  it('treats a label that is already gone as removed, and reports other failures', async () => {
    const status = (code) => async () => ({ ok: false, status: code });
    const gone = githubApi({ token: 't', repo: 'o/r', fetch: status(404) });
    await expect(gone.removeLabel(437, ROADMAP)).resolves.toBeUndefined();
    const down = githubApi({ token: 't', repo: 'o/r', fetch: status(500) });
    await expect(down.removeLabel(437, ROADMAP)).rejects.toThrow(/-> 500$/);
    await expect(down.listLabels()).rejects.toThrow('GET /labels');
  });

  it('never puts the token in an error message', async () => {
    const api = githubApi({
      token: 'secret-token',
      repo: 'o/r',
      fetch: async () => ({ ok: false, status: 403 }),
    });
    await expect(api.listLabels()).rejects.not.toThrow(/secret-token/);
  });
});
