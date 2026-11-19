// Entry for the approval matrix (APPR-007). The attack-lab runs the standard configuration. The policy is the matrix: deny
// lab_echo, allow lab_add, ask lab_mail_send; every other lab tool is unlisted and pauses in mode default.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_DENY"] = "mcp:lab:lab_echo";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:lab:lab_add";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:lab:lab_mail_send";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-matrix");
await import("./lab-matrix.cases.js");
