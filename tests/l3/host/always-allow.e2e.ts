// Entry for the always-allow and pinning cases (META-002, META-004, META-008, META-011). Always allow is on here and only here.
// The approval policy is set before the stack starts, with NO ask rule: LibreChat never offers Always allow for a tool that an
// ask rule matches (a host limit, recorded in docs/findings/l3-always-allow.md). The lab and lab2 must be up (npm run lab:up).
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS"] = "1";
delete process.env["LIBRECHAT_TOOL_APPROVAL_ASK"];
delete process.env["LIBRECHAT_TOOL_APPROVAL_DENY"];

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab", "lab2"]), "always-allow");
await import("./always-allow.cases.js");
