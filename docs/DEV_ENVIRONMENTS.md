# Dev environments — two boxes

No single machine can be a Claude Code cloud session *and* something an editor attaches
to: cloud sessions take no editor connection and never read `.devcontainer/`
([cloud environments](https://code.claude.com/docs/en/cloud-environments)). So there are
two boxes that share toolchain versions and one CI-in-Docker command, not one definition.

| Box | What it is | Reached from | Docker |
|---|---|---|---|
| **Desktop box** | `.devcontainer/devcontainer.json` on the desktop | VS Code / Cursor (Remote Tunnel → Reopen in Container), the Claude CLI in its terminal, and — via `claude remote-control` inside it — claude.ai/code, the phone and the Desktop app | the desktop's own Docker (docker-outside-of-docker) |
| **Cloud box** | the **SplitIQ** cloud environment (`docs/CLOUD_ENVIRONMENT.md`) | cloud sessions from the Desktop app, web, phone, `claude --cloud` | `dockerd` in the session, started on demand by `npm run e2e:docker` |

The desktop box needs the desktop on. The cloud box works with it off.

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

## Desktop box — one-time setup on the desktop

1. Install **Docker Desktop** and **VS Code**. On Windows, use the WSL 2 backend and keep
   the clone **inside WSL** (`~/SplitIQ`, not `/mnt/c/...`): bind mounts from the Windows
   filesystem make `npm ci` and vitest crawl. Run the steps below from the WSL shell.
2. Clone the repo (the main checkout — **not** a git worktree; see the devcontainer header).
3. Start the tunnel as a service so it survives reboots and logout
   ([Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels)):
   ```
   code tunnel service install
   ```
   Sign in with GitHub when asked, and name the machine. Stop the desktop sleeping, or
   the tunnel drops (`code tunnel --no-sleep` for a foreground run).

## Desktop box — from the laptop

1. VS Code → Remote Explorer → **Tunnels** → the desktop → open `~/SplitIQ`.
2. **Dev Containers: Reopen in Container**. The container builds on the desktop's Docker;
   Docker is not needed on the laptop
   ([dev containers over a tunnel](https://code.visualstudio.com/docs/devcontainers/containers#_open-a-folder-on-a-remote-tunnel-host-in-a-container)).
3. In its terminal, `claude` and `/login` once. The login lives in a named volume, so it
   survives rebuilds.

Cursor does not support Remote Tunnels — use VS Code for this route.

## Desktop box — from the phone or the Desktop app (Remote Control)

In the container's terminal:

```
claude remote-control --spawn worktree
```

It prints a URL and shows up at claude.ai/code and in the Claude app; each session it
spawns runs in the container with the desktop's Docker. Requires a claude.ai login (Pro,
Max or higher) and the process to keep running
([Remote Control](https://code.claude.com/docs/en/remote-control)). `--spawn worktree`
gives each session its own worktree inside the container, where `.git` should resolve (reasoned, untested), unlike a
host worktree opened from outside.

## Not yet verified

- The docker-outside-of-docker feature has not been built — only `npm run e2e:docker` in
  the cloud box (Smoke 69 passed, Visual 10 passed against the committed baselines).
- Python 3.13 feature: not built yet.
- Codespaces with docker-outside-of-docker: whether `LOCAL_WORKSPACE_FOLDER` resolves to a
  path its Docker host can mount is untested.
