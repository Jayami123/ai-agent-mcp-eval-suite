import "./policy.js";
import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Mattermost stack job (npm run test:stack:l3:mattermost). One stack (H2 second identity and H7 seeded posts are
// switched on by the job's environment), then the case modules. The harness owns start and stop. The approval policy is in
// policy.ts. In stub mode (the PR job) this runs every case. Under P4_LLM_MODE=nightly, use measured.e2e.ts instead.

bootRuntime(selectServers(["mattermost"]), "mattermost");

// The live probe runs first and only records (CI sets P4_L3_CAPTURE=1).
if (process.env["P4_L3_CAPTURE"] === "1") await import("./capture.cases.js");
await import("./sweep-start.cases.js");
// Protocol cases (all group): PROT-001 at the pinned spec version, PROT-002..012 and OAUTH-001.
await import("../all/prot.cases.js");
await import("../all/conformance.cases.js");
await import("../all/oauth.cases.js");
// Injection, tool-design and end-of-run hygiene.
await import("./inj.cases.js");
await import("./tool.cases.js");
await import("./hygiene.cases.js");
