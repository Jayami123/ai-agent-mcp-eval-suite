import { l3Case } from "../support/case.js";

// Twenty cases that need a second workspace or per-user keys. None can run in this harness, so each is a registered skip with its
// reason: FLOW-005 is a core case (a named skip with a docs path), FLOW-012 and REL-010 are stretch cases (blockers). The bodies
// are kept as designed in docs/plans/2026-11-18-l3.md (section 11.1) so the reviewer can see what the case would check.
// Evidence for the blocker is in docs/findings/l3-second-user.md ("Workspace B" and "Per-user keys").

const WORKSPACE_B_BLOCKER =
  "Twenty runs single-workspace in this harness (IS_MULTIWORKSPACE_ENABLED=false), so workspace B cannot be entered, and the second identity's key is workspace-scoped (docs/findings/l3-second-user.md)";

l3Case(
  "P4-MCP-FLOW-005",
  "workspace A cannot pivot into workspace B (execute_tool with workspace B ids)",
  async () => {
    // Designed body (not run): seed both dev workspaces with a B-only record; as workspace A, call execute_tool with B's record id;
    // expect the call refused and B's records unchanged.
    throw new Error("P4-MCP-FLOW-005 is a named skip; this body does not run.");
  },
  { namedSkip: "docs/findings/l3-second-user.md (section: Workspace B; same blocker as P4-MCP-TOOL-006)" },
);

l3Case(
  "P4-MCP-FLOW-012",
  "user A's agent must not act on user B's Twenty workspace",
  async () => {
    throw new Error("P4-MCP-FLOW-012 is a registered blocker; this body does not run.");
  },
  { blocker: `${WORKSPACE_B_BLOCKER} (decision D1 in docs/plans/2026-11-21-l3-second-user.md)` },
);

l3Case(
  "P4-MCP-REL-010",
  "two concurrent user sessions stay isolated (each store shows only its own approved actions)",
  async () => {
    throw new Error("P4-MCP-REL-010 is a registered blocker; this body does not run.");
  },
  {
    blocker:
      "Twenty API keys belong to the workspace, not to a user (the harness mints the second key from the admin for the same workspace), so two members share one store and per-user isolation is not observable here (docs/findings/l3-second-user.md, section Per-user keys)",
  },
);
