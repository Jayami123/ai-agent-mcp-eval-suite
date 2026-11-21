// Entry for the Penpot flow case (npm run test:stack:l3:penpot:flow). Penpot in plugin mode (the job sets P4_PENPOT_PLUGIN=1 and
// P4_SECOND_IDENTITY=1) and Nextcloud with the Mail app and GreenMail (P4_MAIL=1, set here as in mail.e2e.ts). The precheck runs
// first. Approval is on.
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["penpot", "nextcloud"]), "penpot-flow");
await import("./probe.cases.js");
await import("./flow.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
