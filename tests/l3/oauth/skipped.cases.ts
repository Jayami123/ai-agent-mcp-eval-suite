import { l3Case } from "../support/case.js";

// The OAuth cases this PR cannot build. Each is a named skip (core) or a blocker (stretch) with the pointer to the findings that
// hold the attempt and the harness request. The bodies are kept so each case fails loudly the day its blocker is removed.
// Plan: docs/plans/2026-11-22-l3-oauth-mode.md, sections 4 and 5.

const FINDINGS = "docs/findings/l3-oauth-mode.md";
const NOT_BUILT = (id: string): Error => new Error(`${id} is not built in this PR: remove its named skip after the blocker in ${FINDINGS} is lifted`);

l3Case(
  "P4-MCP-OAUTH-006",
  "scope step-up needs new consent",
  async () => {
    throw NOT_BUILT("P4-MCP-OAUTH-006");
  },
  { namedSkip: `needs a LibreChat browser sign-in and a Twenty consent step, not built here (${FINDINGS}, section 5)` },
);

l3Case(
  "P4-MCP-APPR-009",
  "oauthPrompt on_start vs on_use",
  async () => {
    throw NOT_BUILT("P4-MCP-APPR-009");
  },
  { blocker: `needs the LibreChat browser sign-in (scripts/live/librechat-oauth.mjs) to be driven by a test (${FINDINGS}, section 5)` },
);

l3Case(
  "P4-MCP-PROT-010",
  "scope-checked resources (Nextcloud)",
  async () => {
    throw NOT_BUILT("P4-MCP-PROT-010");
  },
  { namedSkip: `the harness cannot put Nextcloud in OAuth mode (${FINDINGS}, section 4)` },
);

l3Case(
  "P4-MCP-OAUTH-011",
  "unauthenticated scope tampering rejected (Nextcloud)",
  async () => {
    throw NOT_BUILT("P4-MCP-OAUTH-011");
  },
  { namedSkip: `the harness cannot put Nextcloud in OAuth mode (${FINDINGS}, section 4)` },
);
