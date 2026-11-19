/** These conformance scenarios must pass against the benign lab. They may never appear in expected-failures.yaml. */
export const MUST_PASS_SCENARIOS = [
  "server-initialize",
  "ping",
  "tools-list",
  "tools-call-error",
  "dns-rebinding-protection",
  "json-schema-2020-12",
] as const;

/** The spec version the conformance run uses. A recorded deviation from the master plan's 2026-07-28 (plan decision D2). */
export const CONFORMANCE_SPEC_VERSION = "2025-11-25";
