// Entry for the Penpot plugin cases (npm run test:stack:l3:penpot:plugin). The job sets P4_PENPOT_PLUGIN=1 and P4_SECOND_IDENTITY=1
// (the harness needs both: penpot-plugin.ts), which runs the Penpot MCP in multi-user mode with a browser tab per profile. The
// precheck runs first; the cases read its result. Approval is on, every tool needs a decision (the cases choose it).
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["penpot"]), "penpot-plugin");
await import("./probe.cases.js");
await import("./tool.cases.js");
await import("./inj.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
