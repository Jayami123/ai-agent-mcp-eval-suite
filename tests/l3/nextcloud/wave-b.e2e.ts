import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";
import { selectServers } from "../support/stack.js";

// Entry for the approval wave B Nextcloud and Mattermost job (npm run test:stack:l3:wave-b:nextcloud-mattermost). Two servers, one stack.
// Approval (H3): Mattermost post and DM pause; the Mattermost reads and the Nextcloud contact listing are allowed.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:mattermost:create_post,mcp:mattermost:dm";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:mattermost:read_channel,mcp:mattermost:get_channel_info,mcp:nextcloud:nc_contacts_list_contacts,mcp:nextcloud:nc_contacts_list_addressbooks";

bootRuntime(selectServers(["nextcloud", "mattermost"]), "wave-b-nextcloud-mattermost");

await import("./flow.wave-b.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
