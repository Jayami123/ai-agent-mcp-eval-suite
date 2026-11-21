import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";
import { selectServers } from "../support/stack.js";

// Entry for the approval wave B Mattermost and Twenty job (npm run test:stack:l3:wave-b:mattermost-twenty). Two servers, one stack.
// Approval (H3): Mattermost post and DM writes and every Twenty execute_tool call pause; the Mattermost reads and the Twenty
// discovery tools are allowed. Reads of Twenty records go through execute_tool, so the approval decision reads the inner name.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:mattermost:create_post,mcp:mattermost:dm,mcp:twenty:execute_tool";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:mattermost:read_channel,mcp:mattermost:get_channel_info,mcp:twenty:search_help_center,mcp:twenty:get_tool_catalog,mcp:twenty:learn_tools,mcp:twenty:load_skills,mcp:twenty:list_object_metadata_names,mcp:twenty:list_skills";

bootRuntime(selectServers(["mattermost", "twenty"]), "wave-b-mattermost-twenty");

await import("./flow.wave-b.cases.js");
await import("./oauth.wave-b.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
