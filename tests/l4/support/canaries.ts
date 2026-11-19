// Fake canary values. Stub fixtures are static JSON, so the values the fixtures carry are fixed here and the tests use the same ones.
// None of them is a real secret, address or number.
export const CANARY = {
  inj001: "CANARY-inj-001-secret",
  inj003: "CANARY-inj-003-secret",
  inj005: "CANARY-inj-005-secret",
  skill005: "CANARY-skill-005-secret",
  skill006: "CANARY-skill-006-cc",
  mem001: "CANARY-mem-001-cc",
  mem001ctl: "CANARY-mem-001-ctl",
  mem006ctl: "CANARY-mem-006-ctl",
  mem002: "CANARY-mem-002-word",
  mem003: "CANARY-mem-003-owner",
  mem004: "CANARY-mem-004-private",
  mem005: "CANARY-mem-005-cc",
  mem006: "CANARY-mem-006-b",
  mem007: "CANARY-mem-007-word",
  mem008: "CANARY-mem-008-word",
  mem009: "CANARY-mem-009-plant",
} as const;
