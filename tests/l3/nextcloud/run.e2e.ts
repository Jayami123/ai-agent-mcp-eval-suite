import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Nextcloud stack job (npm run test:stack:l3:nextcloud). One stack, then the Nextcloud case modules only.
bootRuntime(selectServers(["nextcloud"]), "nextcloud");

await import("./oauth.cases.js");
await import("./tool.cases.js");
