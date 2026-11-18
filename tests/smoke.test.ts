import { test } from "node:test";
import assert from "node:assert/strict";
import { SUITE_NAME } from "../src/index.js";

test("bootstrap smoke: suite name is exported", () => {
  assert.equal(SUITE_NAME, "ai-agent-mcp-eval-suite");
});
