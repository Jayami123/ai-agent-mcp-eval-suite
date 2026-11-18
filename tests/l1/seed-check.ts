import fs from "node:fs";
import path from "node:path";

// The Twenty list result must name each required standard object (people, companies, opportunities) as a whole word.
// Shared by the stub and nightly tests. Null or empty expectations are "unverified", which is never a pass.

const SEED_EXPECTED_FILE = path.resolve(process.cwd(), "tests", "l1", "twenty-seed.expected.json");

export type StateVerdict = { outcome: "pass" | "fail" | "unverified"; detail: string };

export function readRequiredObjects(): string[] {
  const raw = JSON.parse(fs.readFileSync(SEED_EXPECTED_FILE, "utf8")) as { requiredObjects?: unknown };
  return Array.isArray(raw.requiredObjects) ? raw.requiredObjects.filter((n): n is string => typeof n === "string") : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `text` is the tool result text. Pass undefined when there was no successful result. */
export function checkSeededText(text: string | undefined): StateVerdict {
  const required = readRequiredObjects();
  if (required.length === 0) {
    return { outcome: "unverified", detail: "tests/l1/twenty-seed.expected.json has no requiredObjects" };
  }
  if (text === undefined || text.trim() === "") return { outcome: "fail", detail: "no successful list-tool result to check" };
  const missing = required.filter((name) => !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text));
  if (missing.length > 0) return { outcome: "fail", detail: `required object(s) not in result: ${missing.join(", ")}` };
  return { outcome: "pass", detail: `required objects present: ${required.join(", ")}` };
}
