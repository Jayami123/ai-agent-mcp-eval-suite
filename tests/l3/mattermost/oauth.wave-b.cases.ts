import { l3Case } from "../support/case.js";

// P4-MCP-OAUTH-015 (stretch, Mattermost). Per-tool policies (allow and deny) on the Mattermost MCP. The stretch rule allows a named
// blocker, so the case is registered and skipped with that reason. The reason is recorded in docs/findings/l3-appr-wave-b.md.
// Unskip when the pinned Mattermost MCP shows a per-tool policy setting that the suite can drive.
l3Case(
  "P4-MCP-OAUTH-015",
  "Mattermost MCP tool policies honour allow/deny",
  async () => {
    throw new Error("OAUTH-015 body is kept for the day the blocker is lifted; it is not run while the blocker stands");
  },
  { blocker: "the pinned Mattermost MCP has no per-tool policy setting in its tool list, so a deny cannot be driven (docs/findings/l3-mattermost.md, Still open; docs/findings/l3-appr-wave-b.md, decision D4)" },
);
