import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Mattermost stack job (npm run test:stack:l3:mattermost). One stack (H2 second identity and H7 seeded posts
// are switched on by the job's environment), then the case modules for this group. The harness owns start and stop.
bootRuntime(selectServers(["mattermost"]), "mattermost");

if (process.env["P4_L3_CAPTURE"] === "1") await import("./capture.cases.js");
