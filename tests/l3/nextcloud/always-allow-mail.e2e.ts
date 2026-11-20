// Entry for P4-MCP-APPR-002 and P4-MCP-META-013 (always-allow with the Nextcloud mail stack). Always allow is on here and only
// here, with NO ask rule (LibreChat never offers Always allow for an ask-matched tool). P4_MAIL=1 makes the harness start GreenMail
// and point the Nextcloud Mail app at it. The attack-lab must be up (npm run lab:up). The environment is set before the harness
// reads its config, so it is set before the first import below.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS"] = "1";
delete process.env["LIBRECHAT_TOOL_APPROVAL_ASK"];
delete process.env["LIBRECHAT_TOOL_APPROVAL_DENY"];

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["nextcloud", "lab"]), "always-allow-mail");
await import("./always-allow-mail.cases.js");
