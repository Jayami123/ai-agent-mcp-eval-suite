import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";

// Entry for the approval wave B host job (npm run test:stack:l3:wave-b:host). The registered lab is the only server LibreChat is given;
// the second lab (lab2) runs on the host from the same lab:up step and is deliberately not registered (SUPP-006). Stub mode only.
// Approval is on (H3) so the registered lab's writes would pause; this case calls no write.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

bootRuntime(["lab"], "wave-b-host");

await import("./supp.wave-b.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
