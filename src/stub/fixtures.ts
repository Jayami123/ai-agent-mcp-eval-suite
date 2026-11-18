import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ToolCallSpec {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TurnSpec {
  tool_calls?: ToolCallSpec[];
  content?: string;
}

export interface Fixture {
  id: string;
  description: string;
  turns: TurnSpec[];
}

export const FIXTURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Fallback marker. Global flag: use with matchAll. Never used for traces or assertions. */
export const FIXTURE_MARKER = /\[fixture:([^\]]*)\]/g;

/** Removes fixture markers from text before it is written to any recorded artifact. */
export function stripFixtureMarkers(text: string): string {
  return text.replace(FIXTURE_MARKER, "").trim();
}

export class FixtureNotFoundError extends Error {}
export class FixtureInvalidError extends Error {}

/** Loads and validates one fixture. Throws FixtureNotFoundError or FixtureInvalidError. */
export function loadFixture(fixturesDir: string, id: string): Fixture {
  if (!FIXTURE_ID_PATTERN.test(id)) {
    throw new FixtureInvalidError("invalid fixture id");
  }
  const file = path.join(fixturesDir, `${id}.json`);
  if (!existsSync(file)) {
    throw new FixtureNotFoundError(`unknown fixture id: ${id}`);
  }
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  return validateFixture(raw, id);
}

function fail(expectedId: string, reason: string): never {
  throw new FixtureInvalidError(`invalid fixture: ${expectedId}: ${reason}`);
}

export function validateFixture(raw: unknown, expectedId: string): Fixture {
  if (typeof raw !== "object" || raw === null) fail(expectedId, "not an object");
  const obj = raw as Record<string, unknown>;
  if (obj["id"] !== expectedId) fail(expectedId, "id does not match file name");
  if (typeof obj["description"] !== "string") fail(expectedId, "description must be a string");
  const turns = obj["turns"];
  if (!Array.isArray(turns) || turns.length === 0) fail(expectedId, "turns must be a non-empty array");
  for (const turn of turns as unknown[]) {
    if (typeof turn !== "object" || turn === null) fail(expectedId, "turn must be an object");
    const t = turn as Record<string, unknown>;
    const hasCalls = t["tool_calls"] !== undefined;
    const hasContent = t["content"] !== undefined;
    if (hasCalls === hasContent) fail(expectedId, "each turn needs exactly one of tool_calls or content");
    if (hasCalls) {
      const calls = t["tool_calls"];
      if (!Array.isArray(calls) || calls.length === 0) fail(expectedId, "tool_calls must be a non-empty array");
      for (const call of calls as unknown[]) {
        const c = call as Record<string, unknown>;
        if (typeof c["name"] !== "string" || c["name"] === "") {
          fail(expectedId, "tool call name must be a non-empty string");
        }
        const args = c["arguments"];
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          fail(expectedId, "tool call arguments must be a JSON object");
        }
      }
    } else if (typeof t["content"] !== "string") {
      fail(expectedId, "content must be a string");
    }
  }
  return raw as Fixture;
}
