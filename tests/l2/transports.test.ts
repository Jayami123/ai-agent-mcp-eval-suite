import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connect, startLab } from "./helpers.js";

// The compiled entry point: tests compile to dist-test/, with the same layout as the sources.
const MAIN = path.resolve(process.cwd(), "dist-test/src/attack-lab/main.js");
const STDIO_ENV = { LAB_CONTROL_PORT: "0", LAB_SINK_PORT: "0", LAB_CONTROL_TOKEN: "stdio-test-token-0000" };

async function connectStdio(): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [MAIN, "--stdio"], env: { ...process.env as Record<string, string>, ...STDIO_ENV }, stderr: "pipe" });
  const client = new Client({ name: "l2-stdio-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

test("the same benign list and lab_add result come back over streamable HTTP and over stdio", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const http = await connect(lab);
  t.after(() => http.close());
  const stdio = await connectStdio();
  t.after(() => stdio.close());

  const httpTools = (await http.listTools()).tools;
  const stdioTools = (await stdio.listTools()).tools;
  assert.deepEqual(stdioTools.map((tool) => tool.name), httpTools.map((tool) => tool.name));
  assert.deepEqual(JSON.stringify(stdioTools), JSON.stringify(httpTools));

  const a = await http.callTool({ name: "lab_add", arguments: { a: 4, b: 5 } });
  const b = await stdio.callTool({ name: "lab_add", arguments: { a: 4, b: 5 } });
  assert.deepEqual(a.structuredContent, { sum: 9 });
  assert.deepEqual(b.structuredContent, { sum: 9 });
});

test("stdio: nothing but JSON-RPC frames goes to stdout", async () => {
  const child = spawn(process.execPath, [MAIN, "--stdio"], { env: { ...process.env, ...STDIO_ENV }, stdio: ["pipe", "pipe", "pipe"] });
  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => lines.push(line));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "0" } } })}\n`);
  for (let i = 0; i < 100 && lines.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  child.kill();
  assert.ok(lines.length > 0, "no response on stdout");
  for (const line of lines) {
    const frame = JSON.parse(line) as { jsonrpc?: string };
    assert.equal(frame.jsonrpc, "2.0");
  }
});
