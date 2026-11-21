// Entry for the NCMAIL injection and tool cases: INJ-001, INJ-002, INJ-003, INJ-014 and TOOL-007 (npm run
// test:stack:l3:nc-mail:injection). P4_MAIL=1 starts GreenMail and the Mail app; set here and in no other mail entry.
// Approval (H3): the Nextcloud read tools run with no prompt; every other Nextcloud tool (the mail send, the share and the
// calendar write) pauses and the case rejects it. Stub mode only: no provider key, safe for fork PRs.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = [
  "nc_mail_list_accounts",
  "nc_mail_list_mailboxes",
  "nc_mail_list_messages",
  "nc_mail_get_message",
  "nc_webdav_read_file",
  "nc_calendar_list_events",
  "nc_share_list",
].map((t) => `mcp:nextcloud:${t}`).join(",");

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(selectServers(["nextcloud"]), "nextcloud-mail-injection");
await import("./mail-injection.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
