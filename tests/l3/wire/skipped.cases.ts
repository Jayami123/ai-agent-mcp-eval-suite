import { l3Case } from "../support/case.js";

// The cases and legs this PR cannot build. Each is a named skip (core) with a pointer to the findings, which hold the attempt and
// the harness request. The bodies are kept so each case fails loudly once its blocker is removed.
// Plan: docs/plans/2026-11-22-l3-wire-pair.md, sections 3 and 6.

const FINDINGS = "docs/findings/l3-wire-pair.md";
const NOT_BUILT = (id: string): Error => new Error(`${id} is not built in this PR: remove its named skip after the blocker in ${FINDINGS} is lifted`);

l3Case(
  "P4-MCP-TOOL-003",
  "twenty, penpot and mattermost legs (destructive tools need approval)",
  async () => {
    throw NOT_BUILT("P4-MCP-TOOL-003 (the other legs)");
  },
  { namedSkip: `the Twenty, Penpot and Mattermost stacks are not in the pair job (${FINDINGS}, section 3, W6)` },
);

l3Case(
  "P4-MCP-OAUTH-003",
  "host does not pass a user token to a second server",
  async () => {
    throw NOT_BUILT("P4-MCP-OAUTH-003");
  },
  { namedSkip: `the H9 recorder redacts every Authorization header with no digest, so it cannot show which bearer went where (${FINDINGS}, section 3, W5)` },
);

l3Case(
  "P4-MCP-REL-007",
  "long tool list still goes through approval",
  async () => {
    throw NOT_BUILT("P4-MCP-REL-007");
  },
  { namedSkip: `RAM5: the five-server stack is not measured on the runner (${FINDINGS}, section 3, W7)` },
);
