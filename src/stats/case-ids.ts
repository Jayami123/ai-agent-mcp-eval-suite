export interface L5Case {
  id: string;
  kind: "core" | "stretch";
}

/** Copied from the ledger rows in master plan Appendix A (lane L5). Do not add or rename IDs here. */
export const L5_CASES: readonly L5Case[] = [
  { id: "P4-STAT-001", kind: "core" },
  { id: "P4-STAT-002", kind: "core" },
  { id: "P4-STAT-003", kind: "core" },
  { id: "P4-STAT-004", kind: "core" },
  { id: "P4-STAT-005", kind: "core" },
  { id: "P4-STAT-006", kind: "core" },
  { id: "P4-STAT-007", kind: "core" },
  { id: "P4-GATE-001", kind: "core" },
  { id: "P4-GATE-002", kind: "core" },
  { id: "P4-GATE-003", kind: "core" },
  { id: "P4-GATE-004", kind: "core" },
  { id: "P4-GATE-005", kind: "core" },
  { id: "P4-GATE-006", kind: "stretch" },
  { id: "P4-MCP-REL-006", kind: "core" },
  { id: "P4-MCP-REL-008", kind: "core" },
];

export const CASE_ID_PATTERN = /^P4-([A-Z]+(?:-[A-Z]+)?)-(\d{3})$/;

/** "P4-MCP-OAUTH-001" gives family "MCP-OAUTH" and number 1. Returns null for anything else. */
export function parseCaseId(id: string): { family: string; num: number } | null {
  const m = CASE_ID_PATTERN.exec(id);
  if (m === null) return null;
  return { family: m[1] ?? "", num: Number(m[2]) };
}
