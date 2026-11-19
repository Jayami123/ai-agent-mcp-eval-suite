import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDigests, imageRefs, isDigestPinned } from "../../src/oracles/pin.js";

const D = "sha256:" + "a".repeat(64);

test("imageRefs reads image lines with their line numbers", () => {
  const refs = imageRefs(`services:\n  a:\n    image: redis:8@${D}\n  b:\n    image: "nginx:1"\n`, "x.yml");
  assert.deepEqual(refs.map((r) => [r.image, r.line]), [[`redis:8@${D}`, 3], ["nginx:1", 5]]);
});

test("isDigestPinned needs a 64-hex sha256", () => {
  assert.equal(isDigestPinned(`a@${D}`), true);
  assert.equal(isDigestPinned("a:latest"), false);
  assert.equal(isDigestPinned("a@sha256:abc"), false);
});

test("SUPP-001 drift fixture: a new unpinned image fails", () => {
  const refs = imageRefs(`image: a@${D}\nimage: evil/new:1\n`, "synthetic.yml");
  const v = composeDigests(refs, {});
  assert.equal(v.outcome, "fail");
  assert.match(v.detail, /evil\/new:1/);
});

test("a known finding passes, and a stale one fails", () => {
  assert.equal(composeDigests(imageRefs("image: loc:1\n", "x.yml"), { "loc:1": "local build" }).outcome, "pass");
  assert.equal(composeDigests(imageRefs(`image: loc:1@${D}\n`, "x.yml"), { "loc:1": "local build" }).outcome, "fail");
});

test("no image references is a failure, not a pass", () => {
  assert.equal(composeDigests([], {}).outcome, "fail");
});
