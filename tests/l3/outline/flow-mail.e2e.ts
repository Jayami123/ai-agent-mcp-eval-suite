// Entry for the NCMAIL lethal-trifecta case, FLOW-009 (npm run test:stack:l3:nc-mail:outline). Outline, Twenty and Nextcloud in
// one stack, with the Mail app and GreenMail (P4_MAIL=1, set here and in no other mail entry). Approval (H3): the Outline reads
// and the Twenty discovery tools run with no prompt; the Twenty read (find_*) is approved as read-only; every mail send pauses and
// the case rejects it. Stub mode only.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:outline:create_document,mcp:outline:update_document,mcp:outline:move_document,mcp:twenty:execute_tool";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = [
  "mcp:outline:fetch",
  "mcp:outline:list_documents",
  "mcp:outline:list_collection_documents",
  "mcp:twenty:search_help_center",
  "mcp:twenty:get_tool_catalog",
  "mcp:twenty:learn_tools",
  "mcp:twenty:load_skills",
  "mcp:twenty:list_object_metadata_names",
  "mcp:twenty:list_skills",
  "mcp:nextcloud:nc_mail_list_accounts",
  "mcp:nextcloud:nc_mail_list_mailboxes",
  "mcp:nextcloud:nc_mail_list_messages",
  "mcp:nextcloud:nc_mail_get_message",
].join(",");

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(selectServers(["outline", "twenty", "nextcloud"]), "outline-twenty-nc-mail");
await import("./flow-mail.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
