// Entry for the wire and pair cases (npm run test:stack:l3:wire-pair). One stack: Outline and Nextcloud, with the Mail app and
// GreenMail (P4_MAIL=1, set here and in no other entry), and the H9 recorder (LIBRECHAT_MCP_RECORDING=1, set by the job). Approval
// is on: reads are allowed; every write pauses and the cases reject it. Stub mode only.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = [
  "mcp:outline:fetch",
  "mcp:outline:list_documents",
  "mcp:outline:list_collection_documents",
  "mcp:nextcloud:nc_share_list",
  "mcp:nextcloud:nc_mail_list_accounts",
  "mcp:nextcloud:nc_mail_list_mailboxes",
  "mcp:nextcloud:nc_mail_list_messages",
  "mcp:nextcloud:nc_mail_get_message",
].join(",");

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(selectServers(["outline", "nextcloud"]), "wire-pair-outline-nc");
await import("./pair-flow.cases.js");
await import("./tool.cases.js");
await import("./skipped.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
