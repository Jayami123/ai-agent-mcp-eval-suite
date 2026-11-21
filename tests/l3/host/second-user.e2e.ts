import { registerHygieneTests } from "../support/hygiene.js";

// Entry for the second-user host job (npm run test:stack:l3:second-user:host): REL-002 on the attack-lab, which must already run
// (CI: npm run lab:up). It starts and stops no lab. The Twenty skips and the INJ-016 blocker are registered here too: they run
// no body and need no stack, so the job reports them with their reasons.
await import("./second-user.cases.js");
await import("../twenty/second-user.cases.js");
registerHygieneTests(() => []);
