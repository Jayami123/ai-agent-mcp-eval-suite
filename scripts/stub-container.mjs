// Starts or stops the fixture stub container. The shared network is created when missing, the same way the harness does it.
// Usage: node scripts/stub-container.mjs up|down   (run `npm run build` first for up)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "docker", "stub.compose.yml");
const NETWORK = "qa-harness-p4";

function docker(args, { allowFail = false } = {}) {
  const r = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0 && !allowFail) {
    console.error(`docker ${args.slice(0, 2).join(" ")} failed with exit code ${String(r.status)}`);
    process.exit(r.status ?? 1);
  }
  return r.status === 0;
}

const action = process.argv[2];
if (action === "up") {
  const exists = spawnSync("docker", ["network", "inspect", NETWORK], { stdio: "ignore" }).status === 0;
  if (!exists) docker(["network", "create", "--driver", "bridge", NETWORK]);
  docker(["compose", "-f", compose, "up", "-d", "--build", "--wait"]);
} else if (action === "down") {
  docker(["compose", "-f", compose, "down", "--remove-orphans"]);
} else {
  console.error("usage: node scripts/stub-container.mjs up|down");
  process.exit(2);
}
