import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leaksIn, scanDir } from "../../src/oracles/leak.js";

test("leaksIn finds a secret value, a bearer value and an api key shape, and allows the redacted form", () => {
  assert.deepEqual(leaksIn("token is abcdef0123456789 here", ["abcdef0123456789"]), ["secret-value"]);
  assert.deepEqual(leaksIn("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig", []), ["bearer-value"]);
  assert.deepEqual(leaksIn("key sk-abcdefghijklmnop1234", []), ["api-key-shape"]);
  assert.deepEqual(leaksIn("Bearer [REDACTED] and Bearer [redacted]", []), []);
  assert.deepEqual(leaksIn("short secret abc", ["abc"]), [], "a secret under 8 characters is not searched for");
});

test("scanDir reports file and kind only, skips binary files, and is empty for a clean tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p4-leak-"));
  try {
    fs.mkdirSync(path.join(dir, "a"));
    fs.writeFileSync(path.join(dir, "a", "ok.json"), '{"note":"nothing secret"}');
    fs.writeFileSync(path.join(dir, "a", "bad.txt"), "value: supersecretvalue99");
    fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from("supersecretvalue99"));
    const hits = scanDir(dir, ["supersecretvalue99"]);
    assert.deepEqual(hits, [{ file: path.join("a", "bad.txt"), kind: "secret-value" }]);
    assert.deepEqual(scanDir(path.join(dir, "missing"), ["x"]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
