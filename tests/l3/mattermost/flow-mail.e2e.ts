// Entry for the NCMAIL Mattermost flow cases: FLOW-002 and FLOW-011 (npm run test:stack:l3:nc-mail:flow). Mattermost and
// Nextcloud in one stack. P4_MAIL=1 starts GreenMail and the Mail app; set here and in no other mail entry. Approval (H3): the
// Mattermost channel read and the Nextcloud reads run with no prompt; every mail send pauses and the case rejects it.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = [
  "mcp:mattermost:read_channel",
  "mcp:mattermost:get_channel_info",
  "mcp:nextcloud:nc_mail_list_accounts",
  "mcp:nextcloud:nc_mail_list_mailboxes",
  "mcp:nextcloud:nc_mail_list_messages",
  "mcp:nextcloud:nc_mail_get_message",
].join(",");

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(selectServers(["nextcloud", "mattermost"]), "mattermost-nc-mail-flow");
await import("./flow-mail.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
