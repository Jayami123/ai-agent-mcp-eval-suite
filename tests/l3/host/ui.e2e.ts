// Entry for the wave D UI cases (npm run test:stack:l3:ui). The attack-lab runs in url-elicitation mode with the display title
// "Nextcloud (official)" (see the l3 ui CI job). Every lab tool needs approval: mode default, no rules.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(["lab"], "ui");
await import("./ui.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
