import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Every Twenty find call in a stub fixture must match the source's argument shape, or the tool fails validation before it returns
// anything (the INJ-005 control sent `{}` and got no result). Source at the pinned fork (Jayami123/twenty-crm at 7cbdfec6):
// - find_many: `select` is required and non-empty (engine/core-modules/record-crud/zod-schemas/find-tool.zod-schema.ts:39-41);
//   filters are top-level keys, not a `filter` object (find-tool.zod-schema.ts, the ...filterShape spread); `limit` defaults to 10 (:17-22).
// - find_one: `id` and a non-empty `select` are required (engine/core-modules/record-crud/zod-schemas/find-one-tool.zod-schema.ts:4-16).
// Text filters use the operator names in shared-filter-defs.zod-schema.ts (eq, ilike, startsWith, ...).

const DIR = path.resolve(process.cwd(), "src/stub/fixtures");

interface Call { name: string; arguments: { toolName?: unknown; arguments?: Record<string, unknown> } }

const fixtureFiles = fs.readdirSync(DIR).filter((f) => f.startsWith("p4-mcp-") && f.endsWith(".json"));
const twentyFindCalls = fixtureFiles.flatMap((file) => {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as { turns: Array<{ tool_calls?: Call[] }> };
  return fx.turns.flatMap((t) => (t.tool_calls ?? []).filter((c) => c.name === "execute_tool_mcp_twenty" && String(c.arguments.toolName).startsWith("find_")).map((c) => ({ file, inner: String(c.arguments.toolName), args: c.arguments.arguments ?? {} })));
});

test("the fixtures contain Twenty find calls to check", () => {
  assert.ok(twentyFindCalls.length >= 4, `expected Twenty find calls in the fixtures, found ${twentyFindCalls.length}`);
});

test("every find_many call in a fixture sends a non-empty select array", () => {
  for (const c of twentyFindCalls.filter((x) => x.inner.startsWith("find_many_"))) {
    const select = c.args["select"];
    assert.ok(Array.isArray(select) && select.length > 0, `${c.file}: ${c.inner} has no select (required by find-tool.zod-schema.ts)`);
  }
});

test("every find_one call in a fixture sends an id and a non-empty select array", () => {
  for (const c of twentyFindCalls.filter((x) => x.inner.startsWith("find_one_"))) {
    const select = c.args["select"];
    assert.ok(typeof c.args["id"] === "string" && Array.isArray(select) && select.length > 0, `${c.file}: ${c.inner} needs id and select (find-one-tool.zod-schema.ts)`);
  }
});

test("find_many filters are top-level keys, never wrapped in a filter object", () => {
  for (const c of twentyFindCalls.filter((x) => x.inner.startsWith("find_many_"))) {
    assert.equal(c.args["filter"], undefined, `${c.file}: ${c.inner} wraps its filter in a filter object`);
  }
});
