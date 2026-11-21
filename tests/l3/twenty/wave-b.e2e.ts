import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";
import { selectServers } from "../support/stack.js";

// Entry for the approval wave B Twenty job (npm run test:stack:l3:wave-b:twenty). Twenty only.
// The approval policy (H3) is set before the stack starts: execute_tool (Twenty's one door to records) pauses for approval;
// the catalog read tools and the discovery tools are allowed, so the model can look up the seed without a prompt.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:twenty:execute_tool";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:twenty:search_help_center,mcp:twenty:get_tool_catalog,mcp:twenty:learn_tools,mcp:twenty:load_skills,mcp:twenty:list_object_metadata_names,mcp:twenty:list_skills";

bootRuntime(selectServers(["twenty"]), "wave-b-twenty");

await import("./inj.wave-b.cases.js");
await import("./tool.wave-b.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
