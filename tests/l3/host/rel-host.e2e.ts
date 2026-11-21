import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";

// Entry for REL-003 and REL-004 (npm run test:stack:l3:host-design:rel). The attack-lab must already be running in slow-task mode
// (CI: LAB_MODE=slow-task npm run lab:up). This file starts and stops no lab. Approval is on in default mode: every MCP tool pauses,
// and REL-003 approves its slow call before it stops the run.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

bootRuntime(["lab"], "rel-host");

await import("./rel-host.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
