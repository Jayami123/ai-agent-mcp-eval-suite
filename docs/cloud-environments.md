# Cloud environments

Cloud builders can build and check this repository. Both setups run `scripts/cloud-setup.sh`, which checks Node >= 22 and runs `npm ci` with install scripts enabled (the `qa-portfolio-harness` git dependency builds its `dist` in its prepare step). The script is idempotent and prints no secrets.

No environment variables or secrets are needed. `GEMINI_API_KEY` lives only in GitHub Actions, in a GitHub Environment.

## Cursor cloud

Automatic. Cursor reads `.cursor/environment.json`, whose `install` step is `bash scripts/cloud-setup.sh`. Nothing to configure.

The file sets no base image, so the default Cursor image must provide Node >= 22. If it does not, the script stops with a clear error. The standard alternative is a `.cursor/Dockerfile` that installs Node 22, as the harness repository does.

## Claude Code cloud

In the environment settings, paste this as the setup script:

```bash
bash scripts/cloud-setup.sh
```

Set the network access to a custom allowlist with these hosts:

- `github.com`
- `codeload.github.com`
- `registry.npmjs.org`
- `ghcr.io`

Leave the environment variables empty. Do not add `GEMINI_API_KEY`.

## What runs where

Cloud builders can run:

- `npm run check` (typecheck, tests, build).
- The stub-mode tests. `P4_LLM_MODE` defaults to `stub`.

These stay in GitHub Actions:

- Docker-based product runs. Cloud builders do not start or stop products; the harness owns that.
- The nightly Gemma run (`P4_LLM_MODE=nightly`), which needs `GEMINI_API_KEY`.
