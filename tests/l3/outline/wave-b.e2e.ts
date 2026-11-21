import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";
import { selectServers } from "../support/stack.js";

// Entry for the approval wave B Outline and Twenty job (npm run test:stack:l3:wave-b:outline-twenty). Two servers, one stack.
// Approval (H3): the Outline write tools and every Twenty execute_tool call pause; the Outline reads and the Twenty discovery tools
// are allowed. Twenty reads go through execute_tool, so the decision reads the inner name (find_* approved, the rest rejected).
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:outline:create_document,mcp:outline:update_document,mcp:outline:move_document,mcp:twenty:execute_tool";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:outline:fetch,mcp:outline:list_documents,mcp:outline:list_collection_documents,mcp:twenty:search_help_center,mcp:twenty:get_tool_catalog,mcp:twenty:learn_tools,mcp:twenty:load_skills,mcp:twenty:list_object_metadata_names,mcp:twenty:list_skills";

bootRuntime(selectServers(["outline", "twenty"]), "wave-b-outline-twenty");

await import("./flow.wave-b.cases.js");
await import("./inj.wave-b.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
