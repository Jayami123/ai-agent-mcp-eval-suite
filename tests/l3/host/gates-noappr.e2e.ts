// Entry for the lab cases with no approval policy (REL-001, REL-005). The attack-lab container must be running (CI: the
// l3 lab job's lab:up step; local: docker compose on qa-harness-p4). This file starts the stack through the harness only.
const { bootRuntime } = await import("../support/runtime.js");
const { selectServers } = await import("../support/stack.js");
bootRuntime(selectServers(["lab"]), "lab-gates-noappr");
await import("./gates-noappr.cases.js");
