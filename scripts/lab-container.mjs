// Starts or stops the attack-lab container. The shared network is created when missing, the same way the harness does it.
// Usage: node scripts/lab-container.mjs up|down
//
// `up` writes a fresh per-run control token to .harness/lab/control-token on the host (git-ignored, mode 0600) and passes it
// to the container as the LAB_CONTROL_TOKEN environment variable of the docker compose process. It is never a build arg and
// it is never printed. The image is built from the sources, so no `npm run build` is needed first.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "docker", "p4-lab.compose.yml");
const tokenFile = path.join(root, ".harness", "lab", "control-token");
const NETWORK = "qa-harness-p4";

function docker(args, env = process.env) {
  const r = spawnSync("docker", args, { cwd: root, stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`docker ${args.slice(0, 2).join(" ")} failed with exit code ${String(r.status)}`);
    process.exit(r.status ?? 1);
  }
}

const action = process.argv[2];
if (action === "up") {
  const token = randomBytes(24).toString("hex");
  mkdirSync(path.dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const exists = spawnSync("docker", ["network", "inspect", NETWORK], { stdio: "ignore" }).status === 0;
  if (!exists) docker(["network", "create", "--driver", "bridge", NETWORK]);
  docker(["compose", "-f", compose, "up", "-d", "--build", "--wait"], { ...process.env, LAB_CONTROL_TOKEN: token });
  console.log(`attack-lab is up. Control token: ${path.relative(root, tokenFile)} (not printed).`);
} else if (action === "down") {
  // `down` still interpolates the compose file, so it needs a value for the required variable. It is not used.
  docker(["compose", "-f", compose, "down", "--remove-orphans"], { ...process.env, LAB_CONTROL_TOKEN: "down" });
} else {
  console.error("usage: node scripts/lab-container.mjs up|down");
  process.exit(2);
}
