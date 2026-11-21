import { bootRuntime, runtime } from "../support/runtime.js";
import { registerHygieneTests } from "../support/hygiene.js";

// Entry for APPR-008 (npm run test:stack:l3:host-design:appr). The attack-lab must already be running in app-tool mode (CI:
// LAB_MODE=app-tool npm run lab:up). This file starts and stops no lab. Approval is on in default mode, so the app tool pauses.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";

bootRuntime(["lab"], "appr-app");

await import("./appr-app.cases.js");
registerHygieneTests(() => (process.env["P4_STACK_TESTS"] === "1" ? runtime().stack.secrets() : []));
