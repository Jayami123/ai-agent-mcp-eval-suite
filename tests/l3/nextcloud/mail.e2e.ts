// Entry for the wave D mail cases (npm run test:stack:l3:mail). P4_MAIL=1 starts GreenMail and the Mail app; it is set here and in
// no other entry. Every tool needs approval (mode default, no rules). The attack-lab runs in shadow-name mode (see the l3 mail job).
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

const { bootRuntime, runtime } = await import("../support/runtime.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
bootRuntime(["nextcloud", "lab"], "mail");
await import("./mail.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
