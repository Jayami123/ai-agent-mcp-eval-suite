import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { l3Case } from "../support/case.js";
import { startAuthProxy } from "../support/auth-proxy.js";
import { runtime } from "../support/runtime.js";

// The official conformance suite, pinned in package.json (exact version). A failure that is not in the committed baseline
// is a regression (exit 1). Baselined failures are recorded in tests/l3/snapshots/expected-failures/<server>.yaml.
// L2 pins the stable 0.1.x package as @modelcontextprotocol/conformance. L3 needs the 0.2 line (spec 2026-07-28), installed under
// the alias p4-conformance-2026 so both can exist; its entry file is run with node, not through .bin.
const ENTRY = path.resolve(process.cwd(), "node_modules", "p4-conformance-2026", "dist", "index.js");
const SPEC_VERSION = "2026-07-28";
// Per-server pin. Mattermost's MCP answers initialize with protocolVersion 2025-06-18 and rejects 2026-07-28 ("protocol version
// 2026-07-28 is not supported by this server"). Evidence: the round-1 probe's initialize response (artifact of run 44692016929,
// l3-capture/mattermost.initialize.json) and the round-2 conformance checks (run 44696090074). Other servers keep 2026-07-28.
const SPEC_VERSION_BY_SERVER: Partial<Record<string, string>> = { mattermost: "2025-06-18" };
const specVersionFor = (server: string): string => SPEC_VERSION_BY_SERVER[server] ?? SPEC_VERSION;

l3Case("P4-MCP-PROT-001", "the conformance suite exits 0 against the committed expected-failures baseline", async (ctx) => {
  const rt = runtime();
  for (const server of rt.servers) {
    const { url, authorization } = rt.stack.mcp(server);
    const baseline = path.resolve(process.cwd(), "tests", "l3", "snapshots", "expected-failures", `${server}.yaml`);
    const out = path.resolve(process.cwd(), "evidence", rt.dir, `conformance-${server}`);
    // The CLI cannot send a header, so it talks to a loopback proxy that adds the credential.
    const proxy = await startAuthProxy(url, authorization);
    const args = ["server", "--url", proxy.url, "--spec-version", specVersionFor(server), "--output-dir", out];
    if (fs.existsSync(baseline)) args.push("--expected-failures", baseline);
    // spawnSync would block the event loop and starve the proxy, so the CLI runs through an async spawn.
    const res = await run(process.execPath, [ENTRY, ...args]);
    await proxy.close();
    const text = redact(`${res.stdout}${res.stderr}`, authorization ? [authorization] : []);
    writeEvidence(rt.dir, `conformance-${server}.txt`, text);
    ctx.check(res.status === 0 ? pass(`${server}: conformance exit 0 (baseline ${fs.existsSync(baseline) ? "present" : "absent"})`) : fail(`${server}: conformance exit ${String(res.status)} (baseline ${fs.existsSync(baseline) ? "present" : "absent"}); see evidence`));
  }
});

function run(cmd: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
