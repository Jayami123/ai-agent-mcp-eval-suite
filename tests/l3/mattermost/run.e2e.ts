import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Mattermost stack job (npm run test:stack:l3:mattermost). One stack (H2 second identity and H7 seeded posts are
// switched on by the job's environment), then the case modules. The harness owns start and stop.
// Approval policy (H3), set before the stack starts: writes pause and the injection cases reject them. The read tools the
// cases use are allowed so their controls run without a prompt. Unlisted tools pause (default mode).
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:mattermost:create_post,mcp:mattermost:dm";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:mattermost:read_channel,mcp:mattermost:get_channel_info";

bootRuntime(selectServers(["mattermost"]), "mattermost");

// The live probe runs first and only records (CI sets P4_L3_CAPTURE=1).
if (process.env["P4_L3_CAPTURE"] === "1") await import("./capture.cases.js");
await import("./sweep-start.cases.js");
// Protocol cases (all group): PROT-001 at the pinned spec version, PROT-002..012 and OAUTH-001.
await import("../all/prot.cases.js");
await import("../all/conformance.cases.js");
await import("../all/oauth.cases.js");
// Injection, tool-design and end-of-run hygiene.
await import("./inj.cases.js");
await import("./tool.cases.js");
await import("./hygiene.cases.js");
