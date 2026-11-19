// Entry for the standard-lab G cases (META-010, META-005, META-007, SUPP-007, REL-009). The attack-lab runs the standard
// configuration (npm run lab:up with no overrides). Approval: every lab tool pauses (mode default); mail is named in `ask`.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:lab:lab_mail_send";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-std");
await import("./lab-std.cases.js");
