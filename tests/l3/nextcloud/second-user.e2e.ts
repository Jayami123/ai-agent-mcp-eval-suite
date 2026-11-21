import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";
import { selectServers } from "../support/stack.js";

// Entry for P4-MCP-INJ-012 (npm run test:stack:l3:second-user:nextcloud). The second identity (H2) must be on before the stack
// starts: the harness then creates Nextcloud user qa-user-b and writes its MCP credential to its own run state. Stub mode only.
process.env["P4_SECOND_IDENTITY"] = "1";

bootRuntime(selectServers(["nextcloud"]), "second-user-nextcloud");

await import("./second-user.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
