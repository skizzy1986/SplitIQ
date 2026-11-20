# Dev environments — two boxes

No single machine can be a Claude Code cloud session *and* something an editor attaches
to: cloud sessions take no editor connection and never read `.devcontainer/`
([cloud environments](https://code.claude.com/docs/en/cloud-environments)). So there are
two boxes that share toolchain versions and one CI-in-Docker command, not one definition.

| Box | What it is | Reached from | Docker |
|---|---|---|---|
| **Desktop box** | `.devcontainer/devcontainer.json` on a machine with Docker | VS Code / Cursor (Reopen in Container, locally or over a Remote Tunnel), the Claude CLI in its terminal, and — via `claude remote-control` inside it — claude.ai/code and the Claude app | that machine's own Docker (docker-outside-of-docker) |
| **Cloud box** | the **SplitIQ** cloud environment (`docs/CLOUD_ENVIRONMENT.md`) | cloud sessions from the Desktop app, web, phone, `claude --cloud` | `dockerd` in the session, started on demand by `npm run e2e:docker` |

The desktop box needs its machine on. The cloud box needs nothing running.

## Claude tooling — the same in every box

Scott's skills, agents and doctrine are claude.ai account skills (`anthropic-skills:splitiq*`,
source in the private SplitIQ-ops repo, #674), not repo files. They need nothing installed
per box (Context7, below, is the one exception):

| Where | How the skills arrive | Repo hooks (`.claude/settings.json`) |
|---|---|---|
| Local CLI | synced to `~/.claude/skills/synced/` at sign-in | ✅ |
| Desktop box | the same sync, into the container's `CLAUDE_CONFIG_DIR` volume, after `/login` once | ✅ |
| Cloud box | loaded at session start | ✅ (a single-repo session only — attaching a second repo turns hooks off) |

The root `CLAUDE.md` loads in all three and tells the session to invoke
`anthropic-skills:splitiq` first. Plugins are deliberately not used: a cloud session
never loads them ([cloud environments](https://code.claude.com/docs/en/cloud-environments.md#what-carries-over-from-your-setup)).

**Context7, once per local box.** The cloud box gets Context7 from its environment's
connectors (`docs/CLOUD_ENVIRONMENT.md`). A local CLI and the desktop box do not, so the
Context7-first rule in `CLAUDE.md` has nothing to call there until you add it. Run this
once in each, outside `claude`:

```
claude mcp add --scope user --transport http Context7 https://mcp.context7.com/mcp
claude mcp get Context7   # Status: ✔ Connected
```

The name must be `Context7`. That makes the tools `mcp__Context7__resolve-library-id` and
`mcp__Context7__query-docs`, the names `.claude/settings.json` already allows. Use user
scope: a committed `.mcp.json` would also load in the cloud box and duplicate its
connector. In the desktop box, the entry lands in the `CLAUDE_CONFIG_DIR` volume, so it
survives rebuilds.

**Outside the container (a local CLI, or plain WSL beside the desktop box).** The
container ships Node 22, but a bare Ubuntu does not, and the repo needs it in three
ways. `npm` in `web/` needs it. So does the lint-on-edit hook. And the Strava-data guard
*fails closed* without Node: it blocks every Supabase `execute_sql` until Node is there.
Install Node 22 (CI's `node-version: 22`, `engines: >=22.19` in `web/package.json`) per
user with [nvm](https://github.com/nvm-sh/nvm), not apt's `nodejs`:

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
exec bash -l
nvm install 22
node -v   # v22.x
```

For issues and PRs, install `gh` from GitHub's apt repository
([Debian/Ubuntu steps](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian)),
then run `gh auth login`. On a WSL clone, the container and WSL share the same
`web/node_modules`. Keep both on Node 22, or native modules built by one break in the
other.

## CI in Docker — the same command in both boxes

```
cd web
npm run e2e:docker -- smoke          # Playwright Smoke
npm run e2e:docker -- visual         # Playwright Visual
npm run e2e:docker -- visual:update  # regenerate baselines (commit the PNG diff)
```

Runs the job in `mcr.microsoft.com/playwright:v<lockfile version>-noble`, the image
`e2e-web.yml` runs, so baselines made here are valid in CI. Lint, format, unit tests and
build need no Docker — run them directly in either box.

## Using the dev container

- **Locally:** open the repo in VS Code (or Cursor) with Docker running, then
  **Dev Containers: Reopen in Container**. Open the main checkout, not a git worktree
  (see the devcontainer header).
- **On Windows, clone inside WSL** (e.g. `~/SplitIQ` in Ubuntu), not on a Windows drive.
  On a Windows-drive checkout, the bind mount can't carry Linux file owners. Git in the
  container then refuses the repo ("detected dubious ownership"), and so does every check
  built on `git ls-files`. A WSL clone works when your WSL user is UID 1000 (the first user
  a distro creates), which matches the container's `node` user.
- **On another machine's Docker:** connect VS Code to it over a
  [Remote Tunnel](https://code.visualstudio.com/docs/remote/tunnels), open the repo there,
  then Reopen in Container. The container builds on that machine's Docker
  ([dev containers over a tunnel](https://code.visualstudio.com/docs/devcontainers/containers#_open-a-folder-on-a-remote-tunnel-host-in-a-container)).
  Cursor does not support Remote Tunnels.
- In the container's terminal, `claude` and `/login` once; the login lives in a named
  volume, so it survives rebuilds. `claude remote-control` there exposes the session to
  claude.ai/code and the Claude app ([Remote Control](https://code.claude.com/docs/en/remote-control)).

Scott's own desktop setup — the always-on tunnel, the WSL keep-alive, Remote Control
from the phone — is a private runbook (SplitIQ-ops `docs/DESKTOP_BOX.md`).

## Verified

- Cloud box: `npm run e2e:docker`: Smoke 69 passed, Visual 10 passed against the
  committed baselines.
- Desktop box (Windows 11, Docker Desktop, WSL clone): all four features build
  (docker-outside-of-docker, Python 3.13, Deno, Claude Code). Inside the container, git
  and `check:migrations` work, and `npm run e2e:docker -- visual` passes 10/10 on the
  host's Docker.

## Not yet verified

- Account-skill sync inside the desktop box: assumed to follow `CLAUDE_CONFIG_DIR` into
  the volume (`/skills` in the container's CLI should list `anthropic-skills:splitiq`);
  verified only for a local CLI and a cloud session (#674).
- Codespaces with docker-outside-of-docker: whether `LOCAL_WORKSPACE_FOLDER` resolves to a
  path its Docker host can mount is untested.
