import type { QuarantineEntry } from "./quarantine.js";

/** The committed quarantine list. Empty by default. Every entry needs a reason and either an expiry or a named reviewer. */
export const QUARANTINE: readonly QuarantineEntry[] = [];
