import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configFromEnv, isLabMode } from "./modes.js";
import { createLab, type ListenHost } from "./server.js";
import { runStdio } from "./stdio.js";

function port(name: string, fallback: number): number {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`${name} is not a valid port: ${raw}`);
  return value;
}

const args = process.argv.slice(2);
const stdio = args.includes("--stdio");
const modeIndex = args.indexOf("--mode");
if (modeIndex !== -1) {
  const mode = args[modeIndex + 1] ?? "";
  if (!isLabMode(mode)) throw new Error(`--mode is not a lab mode: ${mode}`);
  process.env["LAB_MODE"] = mode;
}

const config = configFromEnv(process.env);
const host = process.env["LAB_HOST"] ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error("LAB_HOST must be 127.0.0.1 or 0.0.0.0");

// The control token comes from the environment (the container) or is generated per run into .harness/ (git-ignored).
// It is never printed.
let controlToken = process.env["LAB_CONTROL_TOKEN"];
if (controlToken === undefined || controlToken === "") {
  controlToken = randomBytes(24).toString("hex");
  const file = path.resolve(process.cwd(), ".harness/lab/control-token");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, controlToken, { mode: 0o600 });
}

const ports = { mcp: port("LAB_MCP_PORT", 9010), control: port("LAB_CONTROL_PORT", 9011), sink: port("LAB_SINK_PORT", 9012) };
if (stdio) {
  await runStdio(config, controlToken, host as ListenHost, ports);
} else {
  const lab = await createLab({ config, controlToken, host: host as ListenHost, ports });
  console.log(`attack-lab listening on ${lab.mcpUrl}`);
}
