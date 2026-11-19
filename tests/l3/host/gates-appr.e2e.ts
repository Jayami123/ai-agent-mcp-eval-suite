// Entry for the lab cases with the approval policy (META-001, SUPP-003). The policy is set before the stack starts: every lab
// tool pauses (mode default), and the mail tool is named in `ask`. Its own process and stack.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:lab:lab_mail_send";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-gates-appr");
await import("./gates-appr.cases.js");
