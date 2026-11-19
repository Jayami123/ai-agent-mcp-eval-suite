// Entry for SUPP-004. The attack-lab must be started with LAB_SERVER_NAME set to a one-character typo of its pinned name
// (npm run lab:up with LAB_SERVER_NAME=p4-attack-lad). No approval policy: the case checks the identity and the host's calls.
const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-typo");
await import("./lab-typo.cases.js");
