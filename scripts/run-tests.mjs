// Runs every compiled *.test.js under dist-test/ with node --test.
// Node 20 does not expand globs in `node --test` arguments (Node 21+ does), so the
// file list is collected here and passed explicitly. Works on Linux and Windows.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith(".test.js")) out.push(full);
  }
  return out.sort();
}

const files = collect("dist-test");
if (files.length === 0) {
  console.error("no compiled test files found under dist-test/");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
