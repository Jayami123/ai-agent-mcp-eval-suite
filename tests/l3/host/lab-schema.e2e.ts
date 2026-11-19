// Entry for META-006. The attack-lab must be started with LAB_POISON_SURFACE=schema (npm run lab:up with that variable set);
// the case checks the surface before it relies on it. Approval: mail is named in `ask`.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:lab:lab_mail_send";

const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-schema");
await import("./lab-schema.cases.js");
