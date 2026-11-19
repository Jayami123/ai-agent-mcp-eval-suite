import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const compose = read("docker/p4-lab.compose.yml");
const script = read("scripts/lab-container.mjs");

test("compose: LAB_RESOURCE is the URL other containers use to reach the lab", () => {
  assert.match(compose, /^\s+LAB_RESOURCE: http:\/\/p4-attack-lab:9010\/mcp\s*$/m);
  assert.match(compose, /^\s+LAB_ALLOWED_HOSTS: p4-attack-lab:9010\s*$/m);
});

test("compose: every published port is bound to 127.0.0.1; the lab aliases are p4-attack-lab and p4-attack-lab-2", () => {
  const ports = compose.split("\n").filter((line) => /^\s+- "\d+:\d+"|^\s+- "[\d.]+:\d+:\d+"/.test(line));
  // Three ports for the first lab, three for the second (META-011). Each is published on loopback only.
  assert.equal(ports.length, 6);
  for (const line of ports) assert.match(line, /"127\.0\.0\.1:\d+:\d+"/);
  assert.match(compose, /aliases:\s*\n\s+- p4-attack-lab\n/);
  assert.match(compose, /aliases:\s*\n\s+- p4-attack-lab-2\n/);
});

test("compose: lab2 keeps the harness MCP port (9011) inside its container and has its own host ports", () => {
  assert.match(compose, /LAB_MCP_PORT: "9011"/);
  assert.match(compose, /LAB_RESOURCE: http:\/\/p4-attack-lab-2:9011\/mcp/);
  assert.match(compose, /LAB_ALLOWED_HOSTS: p4-attack-lab-2:9011,127\.0\.0\.1:9013/);
  assert.match(compose, /"127\.0\.0\.1:9013:9011"/);
});

test("compose: the control token is an environment variable that must be set, never a build arg", () => {
  assert.match(compose, /LAB_CONTROL_TOKEN: \$\{LAB_CONTROL_TOKEN:\?/);
  assert.equal(/^\s+args:/m.test(compose), false, "no build args");
});

test("lab-container.mjs: writes the token to .harness/lab/control-token, passes it as an env var, never prints it", () => {
  assert.match(script, /\.harness", "lab", "control-token"/);
  assert.match(script, /writeFileSync\(tokenFile, token, \{ mode: 0o600 \}\)/);
  assert.match(script, /\{ \.\.\.process\.env, LAB_CONTROL_TOKEN: token \}/);
  assert.equal(/--build-arg/.test(script), false);
  for (const line of script.split("\n").filter((l) => /console\.(log|error|info|warn)/.test(l))) {
    assert.equal(/\btoken\b/.test(line.replace(/Control token:/, "").replace(/\(not printed\)/, "")), false, `a console line may print the token: ${line.trim()}`);
  }
});
