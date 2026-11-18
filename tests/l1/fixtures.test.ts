import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { canonicalJson } from "../../src/stub/canonical.js";
import { loadFixture, stripFixtureMarkers, validateFixture, FixtureInvalidError, FixtureNotFoundError } from "../../src/stub/fixtures.js";

const FIXTURES_DIR = path.resolve(process.cwd(), "src/stub/fixtures");

test("loads the smoke fixture", () => {
  const fx = loadFixture(FIXTURES_DIR, "smoke-search-001");
  assert.equal(fx.id, "smoke-search-001");
  assert.equal(fx.turns.length, 2);
});

test("unknown fixture id is a not-found error", () => {
  assert.throws(() => loadFixture(FIXTURES_DIR, "does-not-exist"), FixtureNotFoundError);
});

test("path traversal id is rejected before any file access", () => {
  assert.throws(() => loadFixture(FIXTURES_DIR, "../secrets"), FixtureInvalidError);
});

test("rejects a turn with both tool_calls and content", () => {
  const bad = {
    id: "x",
    description: "d",
    turns: [{ content: "a", tool_calls: [{ name: "t", arguments: {} }] }],
  };
  assert.throws(() => validateFixture(bad, "x"), FixtureInvalidError);
});

test("rejects arguments that are not an object", () => {
  const bad = {
    id: "x",
    description: "d",
    turns: [{ tool_calls: [{ name: "t", arguments: [] }] }],
  };
  assert.throws(() => validateFixture(bad, "x"), FixtureInvalidError);
});

test("canonicalJson sorts keys recursively", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("stripFixtureMarkers removes the marker and trims", () => {
  assert.equal(stripFixtureMarkers("[fixture:smoke-search-001] Search fake-alpha."), "Search fake-alpha.");
  assert.equal(stripFixtureMarkers("a [fixture:x] b"), "a  b");
});
