import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Mattermost stack job (npm run test:stack:l3:mattermost). One stack (H2 second identity and H7 seeded posts
// are switched on by the job's environment), then the case modules for this group. The harness owns start and stop.
// The protocol cases (PROT-*, OAUTH-001) run against the Mattermost MCP as they do for every server. TOOL-001 and TOOL-004
// need a Mattermost fixture plan and are not imported yet (see docs/plans/2026-11-20-l3-mattermost-wave.md, section 1).
bootRuntime(selectServers(["mattermost"]), "mattermost");

await import("../all/prot.cases.js");
await import("../all/conformance.cases.js");
await import("../all/oauth.cases.js");
if (process.env["P4_L3_CAPTURE"] === "1") await import("./capture.cases.js");
