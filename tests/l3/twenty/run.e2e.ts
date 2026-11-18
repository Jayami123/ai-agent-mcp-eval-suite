import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Twenty stack job (npm run test:stack:l3:twenty). One stack, then every case module for this group.
// Each later PR that lands a server adds that name to the list below and its own run.e2e.ts.
bootRuntime(selectServers(["twenty"]), "twenty");

await import("../all/prot.cases.js");
await import("../all/conformance.cases.js");
await import("../all/oauth.cases.js");
if (process.env["P4_L3_CAPTURE"] === "1") await import("./capture.cases.js");
