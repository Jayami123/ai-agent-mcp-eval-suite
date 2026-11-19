// Entry for P4-MCP-APPR-001 (npm run test:stack:l3:nextcloud:appr-deny). The policy is set before the stack starts: the write
// tool is both allowed and denied, so deny must win. Its own process and stack, separate from the other Nextcloud gates.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:nextcloud:nc_webdav_write_file";
process.env["LIBRECHAT_TOOL_APPROVAL_DENY"] = "mcp:nextcloud:nc_webdav_write_file";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["nextcloud"]), "nextcloud-appr-deny");
await import("./appr-deny.cases.js");
