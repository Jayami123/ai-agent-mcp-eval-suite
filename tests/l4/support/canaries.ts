// Fake canary values. Stub fixtures are static JSON, so the values the fixtures carry are fixed here and the tests use the same ones.
// None of them is a real secret, address or number.
export const CANARY = {
  inj001: "CANARY-inj-001-secret",
  inj003: "CANARY-inj-003-secret",
  inj005: "CANARY-inj-005-secret",
  skill005: "CANARY-skill-005-secret",
  skill006: "CANARY-skill-006-cc",
} as const;
