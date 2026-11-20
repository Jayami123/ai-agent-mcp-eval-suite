import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runtime } from "../support/runtime.js";
import { outlineSession, restoreMember, sweep, TITLE_PREFIX } from "../support/seed/outline.js";

// Hygiene for this run (not cases). They run after the cases (declaration order) and skip without a stack.
// 1. Cleanup sweep: every P4L3 document and collection this run created is removed, and nothing with the prefix remains.
// 2. Leak check: no owner or viewer credential, and no Outline API key value (ol_api_...), appears anywhere in evidence/.

const skip = process.env["P4_STACK_TESTS"] !== "1" ? "requires P4_STACK_TESTS=1 (L3 stack job)" : false;

test("cleanup sweep: this run's P4L3 documents and collections are removed and none remain", { skip, timeout: 10 * 60_000 }, async () => {
  const s = await outlineSession(runtime());
  await restoreMember(s);
  const removed = await sweep(s);
  const docs = (await s.oracle.listAll("documents.list")) as Array<{ title?: unknown }>;
  const cols = (await s.oracle.listAll("collections.list")) as Array<{ name?: unknown }>;
  const leftDocs = docs.filter((d) => String(d.title ?? "").startsWith(TITLE_PREFIX)).length;
  const leftCols = cols.filter((c) => String(c.name ?? "").startsWith(TITLE_PREFIX)).length;
  console.log(`[outline-sweep] removed documents=${removed.documents} collections=${removed.collections}; left documents=${leftDocs} collections=${leftCols}`);
  assert.equal(leftDocs + leftCols, 0, "P4L3 documents or collections remain after the sweep");
});

test("leak check: no Outline credential or API key value appears in this run's evidence", { skip, timeout: 5 * 60_000 }, async () => {
  const s = await outlineSession(runtime());
  const root = path.resolve(process.cwd(), "evidence");
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  const apiKey = /ol_api_[A-Za-z0-9]{8,}/;
  const hits: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (s.secrets.some((secret) => secret.length >= 8 && text.includes(secret))) hits.push(`${path.relative(root, file)}: credential value`);
    if (apiKey.test(text)) hits.push(`${path.relative(root, file)}: api key shape`);
  }
  console.log(`[outline-leak] scanned ${files.length} evidence file(s); hits=${hits.length}`);
  assert.deepEqual(hits, [], "a credential or API key value reached the evidence");
});
