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
source in the private SplitIQ-ops repo, #674), not repo files. Nothing per box to install:

| Where | How the skills arrive | Repo hooks (`.claude/settings.json`) |
|---|---|---|
| Local CLI | synced to `~/.claude/skills/synced/` at sign-in | ✅ |
| Desktop box | the same sync, into the container's `CLAUDE_CONFIG_DIR` volume, after `/login` once | ✅ |
| Cloud box | loaded at session start | ✅ (a single-repo session only — attaching a second repo turns hooks off) |

The root `CLAUDE.md` loads in all three and tells the session to invoke
`anthropic-skills:splitiq` first. Plugins are deliberately not used: a cloud session
never loads them ([cloud environments](https://code.claude.com/docs/en/cloud-environments.md#what-carries-over-from-your-setup)).

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

## Not yet verified

- The docker-outside-of-docker feature has not been built — only `npm run e2e:docker` in
  the cloud box (Smoke 69 passed, Visual 10 passed against the committed baselines).
- Python 3.13 feature: not built yet.
- Account-skill sync inside the desktop box: assumed to follow `CLAUDE_CONFIG_DIR` into
  the volume (`/skills` in the container's CLI should list `anthropic-skills:splitiq`);
  verified only for a local CLI and a cloud session (#674).
- Codespaces with docker-outside-of-docker: whether `LOCAL_WORKSPACE_FOLDER` resolves to a
  path its Docker host can mount is untested.
