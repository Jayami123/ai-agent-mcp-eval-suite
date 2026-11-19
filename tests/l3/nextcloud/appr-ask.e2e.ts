// Entry for P4-MCP-APPR-006 (npm run test:stack:l3:nextcloud:appr-ask). The write tool needs approval (mode default, no
// allow rule), so each conversation pauses before it writes. Its own process and stack.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:nextcloud:nc_webdav_write_file";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["nextcloud"]), "nextcloud-appr-ask");
await import("./appr-ask.cases.js");
