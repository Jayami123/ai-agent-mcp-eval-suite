import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ProductAdapter } from "qa-portfolio-harness";
import { secondAuthorization } from "../../../src/oracles/mattermost.js";
import { mmSeedSession, sweepSuite } from "../support/seed/mattermost.js";
import { runtime } from "../support/runtime.js";

// Needs the stack (P4_STACK_TESTS=1). The plain PR gate skips these, as the registered cases do.
const STACK_ONLY = { skip: process.env["P4_STACK_TESTS"] === "1" ? false : "requires P4_STACK_TESTS=1 (L3 stack job)" };

// End-of-run hygiene. Plain tests (not registered cases). The sweep leaves no active P4L3 channel, no refused post and no
// refused archive. The leak check scans every evidence file for the two bearer values and for any "Bearer <token>" text. It
// names the file on a hit and never prints the value.

test("MM hygiene (end): the cleanup sweep leaves no active P4L3 channel and no refused post or archive", STACK_ONLY, async () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const s = await mmSeedSession(adapter, rt.stack.mcp("mattermost").authorization ?? "");
  const r = await sweepSuite(s);
  assert.deepEqual(r.left, [], "P4L3 channels still active after the sweep");
  assert.equal(r.postsRefused, 0, "posts the sweep could not delete");
  assert.equal(r.archivesRefused, 0, "channels the sweep could not archive");
});

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test("MM hygiene (end): the evidence holds no bearer, PAT or Authorization header value", STACK_ONLY, () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const values = [rt.stack.mcp("mattermost").authorization ?? "", secondAuthorization(adapter)]
    .map((v) => v.replace(/^Bearer\s+/i, ""))
    .filter((v) => v.length >= 10);
  assert.ok(values.length === 2, "both bearer values must be known so the scan can check them");
  const hits: string[] = [];
  for (const file of walk(path.resolve("evidence"))) {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    if (values.some((v) => text.includes(v))) hits.push(`${rel}: a bearer value`);
    if (/Bearer\s+[A-Za-z0-9._~+/-]{16,}/.test(text)) hits.push(`${rel}: an Authorization header value`);
  }
  assert.deepEqual(hits, [], "secret-shaped text found in evidence (values not printed)");
});
