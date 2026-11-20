import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Outline stack job (npm run test:stack:l3:outline). One Outline stack, then the Outline case modules.
// The approval policy (H3) is set before the stack starts: the write tools pause for approval, and the INJ cases reject them.
// The live probe runs first (only with P4_L3_OUTLINE_PROBE=1); it records and asserts nothing.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:outline:create_document,mcp:outline:update_document,mcp:outline:move_document";
// Under mode "default" every tool not listed here pauses for approval. Reads are allowed so the control and hostile runs can read the page.
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:outline:fetch,mcp:outline:list_documents,mcp:outline:list_collection_documents";

bootRuntime(selectServers(["outline"]), "outline");

await import("./probe.cases.js");
await import("./oauth.cases.js");
await import("./inj.cases.js");
await import("./hygiene.cases.js");
