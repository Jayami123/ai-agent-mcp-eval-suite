import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Outline stack job (npm run test:stack:l3:outline). One Outline stack, then the Outline case modules only.
// The live probe runs first (only with P4_L3_OUTLINE_PROBE=1); it is a recording and asserts nothing.
bootRuntime(selectServers(["outline"]), "outline");

await import("./probe.cases.js");
