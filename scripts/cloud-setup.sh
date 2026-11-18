#!/usr/bin/env bash
# One setup entry point for cloud environments (Cursor `install`, Claude Code setup script).
#
# Checks Node >= 22, then runs npm ci with install scripts enabled: the qa-portfolio-harness git
# dependency builds its dist in its prepare step, so scripts must not be disabled.
# Idempotent (npm ci replaces node_modules each run). Prints no secrets and needs none.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf 'cloud-setup: %s\n' "$*"; }
fail() { printf 'cloud-setup: ERROR %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is not on PATH. Node >= 22 is required."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  fail "Node $(node --version) found. Node >= 22 is required."
fi
log "Node $(node --version)"

cd "$REPO_ROOT"
[ -f package-lock.json ] || fail "package-lock.json is missing. Cannot run npm ci."

# Scripts stay enabled: ignore any ambient setting that would turn them off.
unset npm_config_ignore_scripts NPM_CONFIG_IGNORE_SCRIPTS
log "npm ci (scripts enabled)"
npm ci --ignore-scripts=false
log "done"
