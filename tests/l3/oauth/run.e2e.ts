// Entry for the OAuth cases (npm run test:stack:l3:oauth). The job sets LIBRECHAT_MCP_OAUTH=1 and P4_L3_SERVERS=twenty: the harness
// registers a public client with Twenty before LibreChat starts (librechat-oauth.ts). The Twenty cases are raw-HTTP probes; the
// skipped cases are named in the findings. Approval is not used here.
const { bootRuntime, runtime } = await import("../support/runtime.js");
const { registerHygieneTests } = await import("../support/hygiene.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["twenty"]), "oauth");
await import("./oauth.cases.js");
await import("./skipped.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
