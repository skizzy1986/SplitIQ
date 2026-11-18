// Keeps `epic: <n> …` labels in step with the sub-issue hierarchy.
//
// The hierarchy is the source of truth: a slice is a sub-issue of its epic
// (an issue labelled `type: epic`). The label is the copy people scan for in
// the issue and pull-request lists, where sub-issues do not show. It is set
// here and nowhere else, so it cannot drift from the hierarchy the way a
// hand-applied label or a "Part of #n" line does (the private workflow doc §1, #586).
//
// One full reconcile per run rather than a reaction to the event that woke
// it: GitHub has no workflow trigger for "sub-issue added", so any run has to
// be able to repair whatever happened since the last one.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EPIC_TYPE_LABEL = 'type: epic';

const EPIC_LABEL = /^epic: (\d+)(?: .+)?$/;

// GitHub allows a sub-issue tree eight levels deep; the cap is a backstop
// against a cycle the API should never return.
const MAX_DEPTH = 8;

// The issue a PR title names: the number in its last bracket (the private workflow doc §3).
export function issueNumberFromTitle(title) {
  const match = /\S \(#(\d+)\)$/.exec(title ?? '');
  return match ? Number(match[1]) : null;
}

// The label for epic `number` among the repo's labels. A named label from
// labels.yml (`epic: 432 roadmap`) wins over the bare fallback (`epic: 432`).
export function epicLabelName(labelNames, number) {
  const mine = labelNames.filter((name) => {
    const match = EPIC_LABEL.exec(name);
    return match && Number(match[1]) === number;
  });
  return mine.find((name) => name !== `epic: ${number}`) ?? mine[0] ?? null;
}

const names = (item) => item.labels.map((label) => label.name ?? label);

// What has to change so that every descendant of an open epic, and every open
// PR that names one, carries exactly that epic's label.
export async function plan(api) {
  const repoLabels = await api.listLabels();
  const labelNames = repoLabels.map((label) => label.name);
  const epics = (await api.listOpenEpics()).filter((i) => !i.pull_request);

  const create = [];
  const labelOf = new Map(); // epic number -> label name
  for (const epic of epics) {
    let name = epicLabelName(labelNames, epic.number);
    if (!name) {
      name = `epic: ${epic.number}`;
      create.push({
        name,
        // The epic type's own colour, so no colour is typed here.
        color: repoLabels.find((l) => l.name === EPIC_TYPE_LABEL)?.color,
        description: `Sub-issues of #${epic.number} and their PRs. Set by epic-labels.yml, never by hand.`,
      });
    }
    labelOf.set(epic.number, name);
  }
  const managed = new Set(labelOf.values());

  // Every descendant of each epic, and the label it should carry. An issue
  // has one parent, so one label. A nested epic takes the outer epic's label
  // and its own descendants take its own: the nearest epic wins.
  const want = new Map(); // issue number -> label name
  const seen = new Map(); // issue number -> the issue as the API returned it
  for (const epic of epics) {
    let level = [epic.number];
    for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
      const next = [];
      for (const parent of level) {
        for (const child of await api.listSubIssues(parent)) {
          if (seen.has(child.number)) continue;
          seen.set(child.number, child);
          want.set(child.number, labelOf.get(epic.number));
          const isEpic = names(child).includes(EPIC_TYPE_LABEL);
          if (!isEpic && (child.sub_issues_summary?.total ?? 0) > 0) {
            next.push(child.number);
          }
        }
      }
      level = next;
    }
  }

  // An open PR takes the label of the issue its title names, or the epic's
  // own label when it names the epic itself.
  for (const pull of await api.listOpenPulls()) {
    const issue = issueNumberFromTitle(pull.title);
    const label = want.get(issue) ?? labelOf.get(issue);
    seen.set(pull.number, pull);
    if (label) want.set(pull.number, label);
  }

  const add = [];
  const remove = [];
  for (const [number, label] of want) {
    if (!names(seen.get(number)).includes(label)) add.push({ number, label });
  }
  // Anything carrying a managed label it should not have: moved to another
  // epic, detached, or labelled by hand. A closed PR is history and is left.
  for (const label of managed) {
    if (!labelNames.includes(label)) continue;
    for (const item of await api.listLabelled(label)) {
      if (item.pull_request && item.state === 'closed') continue;
      if (want.get(item.number) !== label) {
        remove.push({ number: item.number, label });
      }
    }
  }
  return { create, add, remove };
}

export async function reconcile(api, { dryRun = false, log = () => {} } = {}) {
  const changes = await plan(api);
  for (const label of changes.create) {
    log(`create label "${label.name}"`);
    if (!dryRun) await api.createLabel(label);
  }
  for (const { number, label } of changes.add) {
    log(`#${number}: add "${label}"`);
    if (!dryRun) await api.addLabel(number, label);
  }
  for (const { number, label } of changes.remove) {
    log(`#${number}: remove "${label}"`);
    if (!dryRun) await api.removeLabel(number, label);
  }
  return changes;
}

// The REST calls, as documented at docs.github.com/en/rest/issues/sub-issues
// and docs.github.com/en/rest/issues/labels (read 2026-11-16). The issues
// endpoints answer for pull requests too: "Every pull request is an issue".
export function githubApi({
  token,
  repo,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const base = `https://api.github.com/repos/${repo}`;
  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = new Error(`${method} ${path} -> ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async function all(path) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await call('GET', `${path}${sep}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  const label = (name) => encodeURIComponent(name);
  return {
    listLabels: () => all('/labels'),
    listOpenEpics: () =>
      all(`/issues?state=open&labels=${label(EPIC_TYPE_LABEL)}`),
    listSubIssues: (number) => all(`/issues/${number}/sub_issues`),
    listOpenPulls: () => all('/pulls?state=open'),
    listLabelled: (name) => all(`/issues?state=all&labels=${label(name)}`),
    createLabel: (body) => call('POST', '/labels', body),
    addLabel: (number, name) =>
      call('POST', `/issues/${number}/labels`, { labels: [name] }),
    async removeLabel(number, name) {
      try {
        await call('DELETE', `/issues/${number}/labels/${label(name)}`);
      } catch (error) {
        // Already gone: the state this run wanted.
        if (error.status !== 404) throw error;
      }
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, DRY_RUN } = process.env;
  if (!token || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
    process.exit(2);
  }
  const changes = await reconcile(githubApi({ token, repo }), {
    dryRun: DRY_RUN === '1',
    log: (line) => console.log(line),
  });
  const total =
    changes.create.length + changes.add.length + changes.remove.length;
  console.log(
    total === 0
      ? 'Epic labels already match the hierarchy.'
      : `${total} change(s).`
  );
}
