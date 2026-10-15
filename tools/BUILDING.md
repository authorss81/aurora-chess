# Build workflow: let GitHub do the compiling

## Why

The desktop app is a Tauri shell. That means its dependency tree is roughly
400 crates — the whole WebView2 binding stack, not just our code. On this
machine (Athlon 200GE, 2 cores) a cold build takes 20 to 40 minutes, and an
incremental one is still several minutes. That makes a local build loop useless.

GitHub-hosted **standard** runners are free for public repositories. So the loop
is:

```
edit locally  ->  push  ->  CI compiles  ->  download the artifact
```

You never wait on a local build, and you never pay anything.

## The command

```powershell
git push
gh run watch -R authorss81/aurora-chess        # watches the newest run
```

`gh run watch <id> --repo authorss81/aurora-chess --exit-status` watches one
specific run and returns a non-zero exit code if anything fails. That is the
fastest way to spot a failure — it prints each step as it turns green or red,
so you can see exactly which step died instead of scrolling through a log.

## Downloading

```powershell
pwsh tools\get-artifact.ps1
```

That waits for the run to finish, prints every job with its conclusion, fails
loudly if any job failed, and unpacks the artifacts into `dist/`.

You end up with:

```
dist\aurora-chess-desktop-windows\nsis\Aurora Chess_0.1.0_x64-setup.exe
dist\aurora-chess-release\engine\aurora-engine.exe
dist\aurora-chess-release\web\index.html
dist\aurora-chess-release\engine\aurora-engine-linux
```

Double-click the installer. That is the dedicated Windows application.

## What the CI does

| job | what it proves |
|---|---|
| `rust` (Linux) | fmt, clippy `-D warnings`, 53 unit tests, perft ×6 at depth 4, depth 5 on startpos and kiwipete |
| `rust-windows` | the same tests on Windows, plus a release build |
| `javascript` | the browser movegen matches published perft counts; 26 smoke tests cover SAN, mates, stalemate, promotions, eval |
| `selfplay` | plays 20 plies and verifies with python-chess that every move is legal |
| `desktop` | builds the NSIS installer, uploads it |
| `build-output` | packages engine (Windows + Linux) and web assets |

## About making the repo private afterwards

GitHub's policy: standard runners are **free for public repositories**; private
repositories get 2,000 minutes per month on the Free plan. So building while
public costs nothing.

The usual reason for going private is that the work is not ready to publish, or
contains something you do not want out. If that is the case here, the practical
caveat is worth knowing:

* making it private stops burning the free public minutes, and your next build
  starts drawing on the 2,000/month personal quota
* your own hardware cannot realistically replace it — the desktop build is the
  one thing this machine cannot do quickly
* pushing to a private repo is fine; it is only the *CI minutes* that change

This particular project has no reason to be private. It is a chess engine you
wrote from scratch, with the textbook that taught you to write it. Publishing
it is the better default, and it is what keeps CI unlimited.

## When you should still build locally

Rarely, but for two things:

* **the engine** — `cargo build --release` on `01-learning-engine` takes about
  7 seconds warm, because it has no dependencies at all. Build and test this
  locally as often as you like.
* **the browser GUI** — `node server.js`, no compile step whatsoever.

Only the Tauri shell needs the cloud.