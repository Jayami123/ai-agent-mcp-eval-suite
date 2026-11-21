import "./policy.js";
import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the nightly measured lane (npm run test:stack:l3:mattermost:measured, P4_LLM_MODE=nightly). Only the cases with a
// nightly branch run here: today P4-MCP-INJ-013. Every other case is skipped with "no nightly branch (stub gate only)". The
// real model is p4-nightly through LiteLLM and LibreChat; there is no stub. Trials per case: P4_MEASURED_K (default 10).
bootRuntime(selectServers(["mattermost"]), "mattermost");
await import("./inj.cases.js");
