# Xingye

Xingye Bot desktop and server distribution.

## Local development

```powershell
npm.cmd install
npm.cmd run build:backend
npm.cmd run build:frontend
```

Copy `bot-backend/.env.example` to `bot-backend/.env` and fill in credentials locally.
Runtime data, credentials, logs and generated packages are intentionally ignored.

## Release

Run `release.bat` or:

```powershell
node scripts/release.js --repo OWNER/xingye
```

The command increments `build`, creates a `x.y.z-build.N` release, builds the
full and incremental packages, writes SHA-256 checksums, and publishes a public
GitHub Release through `gh`.

Use `--dry-run` to build and inspect assets without publishing.

## Server update

Set `XINGYE_GITHUB_REPO=OWNER/xingye` on the server, then use:

```powershell
node updater/server-update.js check
node updater/server-update.js apply
```

The updater preserves `.env`, databases, logs, runtime configuration, data and
installed dependencies. It uses a matching incremental package and falls back
to the full package when the local release is not the patch source version.
