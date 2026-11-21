import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

// Attack-lab access for the L3 host cases. The lab is an L2 product in this repo: it is started by `npm run lab:up` (CI) or
// `node dist/attack-lab/main.js` (local), never by a test. Tests only read its endpoints. The control token is read from the
// file the lab writes, sent as a bearer header, and never printed or put in a verdict.

export const LAB = {
  mcp: process.env["LAB_MCP_URL"] ?? "http://127.0.0.1:9010/mcp",
  control: process.env["LAB_CONTROL_URL"] ?? "http://127.0.0.1:9011",
  sink: process.env["LAB_SINK_URL"] ?? "http://127.0.0.1:9012",
};

/** The second lab (docker/p4-lab.compose.yml, service p4-attack-lab-2). Same token file: one per-run token for both. */
export const LAB2 = {
  mcp: process.env["LAB2_MCP_URL"] ?? "http://127.0.0.1:9013/mcp",
  control: process.env["LAB2_CONTROL_URL"] ?? "http://127.0.0.1:9014",
  sink: process.env["LAB2_SINK_URL"] ?? "http://127.0.0.1:9015",
};

/** Which attack-lab a helper talks to. Default "lab"; META-011 reads "lab2" as well. */
export type LabName = "lab" | "lab2";
const endpoints = (which: LabName) => (which === "lab2" ? LAB2 : LAB);

const TOKEN_FILE = path.resolve(process.cwd(), ".harness", "lab", "control-token");

function controlToken(): string {
  const t = readFileSync(TOKEN_FILE, "utf8").trim();
  if (t === "") throw new Error("LAB_NO_CONTROL_TOKEN: .harness/lab/control-token is empty (start the lab first)");
  return t;
}

/** One control call. Returns the parsed JSON reply; a non-2xx status throws with the status only. */
export async function labControl(route: string, body?: Record<string, unknown>, which: LabName = "lab"): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoints(which).control}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${controlToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`LAB_CONTROL_HTTP_${res.status} on ${route}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function labState(which: LabName = "lab"): Promise<Record<string, unknown>> {
  const res = await fetch(`${endpoints(which).control}/control/state`, { headers: { authorization: `Bearer ${controlToken()}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`LAB_STATE_HTTP_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Back to the start mode, empty log and sink. Every case starts and ends with it so cases cannot see each other. */
export async function resetLab(which: LabName = "lab"): Promise<void> {
  await labControl("/control/reset", undefined, which);
}

/**
 * The same server over stdio (`--stdio`), in a child process. The child's control and sink ports are set to 0 so it cannot
 * collide with the running lab. It sends initialize and tools/list and returns the replies. The child is killed afterwards.
 */
export async function stdioListTools(): Promise<{ serverName: unknown; toolNames: string[] }> {
  const child = spawn(process.execPath, [path.resolve(process.cwd(), "dist", "attack-lab", "main.js"), "--stdio"], {
    env: { ...process.env, LAB_MODE: "benign", LAB_MCP_PORT: "0", LAB_CONTROL_PORT: "0", LAB_SINK_PORT: "0", LAB_CONTROL_TOKEN: randomBytes(16).toString("hex") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const replies = new Map<number, unknown>();
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line) as { id?: unknown };
      if (typeof msg.id === "number") replies.set(msg.id, msg);
    } catch {
      // stdout carries protocol frames only; a non-JSON line is ignored here and shows up as a missing reply.
    }
  });
  const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  const waitFor = async (id: number): Promise<unknown> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const r = replies.get(id);
      if (r !== undefined) return r;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`STDIO_NO_REPLY: id ${id}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p4-l3", version: "0" } } });
    const init = (await waitFor(1)) as { result?: { serverInfo?: { name?: unknown } } };
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const list = (await waitFor(2)) as { result?: { tools?: Array<{ name: string }> } };
    return { serverName: init.result?.serverInfo?.name, toolNames: (list.result?.tools ?? []).map((t) => t.name) };
  } finally {
    child.kill("SIGTERM");
  }
}

/** The lab control log: one entry per event ({ seq, event, detail }). Read-only. */
export interface LabLogEntry {
  seq: number;
  event: string;
  detail: Record<string, unknown>;
}
export async function labLog(which: LabName = "lab"): Promise<LabLogEntry[]> {
  const res = await fetch(`${endpoints(which).control}/control/log`, { headers: { authorization: `Bearer ${controlToken()}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`LAB_LOG_HTTP_${res.status}`);
  return ((await res.json()) as { entries: LabLogEntry[] }).entries;
}

/** The mail sink: one record per executed send ({ seq, kind, data }). Records need the control token. */
export interface SinkRecord {
  seq: number;
  kind: string;
  data: Record<string, unknown>;
}
export async function sinkRecords(which: LabName = "lab"): Promise<SinkRecord[]> {
  const res = await fetch(`${endpoints(which).sink}/sink/records`, { headers: { authorization: `Bearer ${controlToken()}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`LAB_SINK_HTTP_${res.status}`);
  return ((await res.json()) as { records: SinkRecord[] }).records;
}

/** The lab's documented fake canaries (src/attack-lab/modes.ts). Used only to recognise records, never printed in a verdict. */
export const CANARY_EMAIL_ADDR = "canary-bcc@example.invalid";
export const CANARY_SECRET_VALUE = "canary-secret-p4-lab-0001";

/** The committed benign pin (server name, version and tools). Read once per process. */
export interface LabPin {
  serverName: string;
  serverVersion: string;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: unknown }>;
}
export function labPin(): LabPin {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "tests", "l3", "snapshots", "lab.tools.json"), "utf8")) as LabPin;
}

/** A fresh MCP session against the lab: initialize, then tools/list. The serverInfo comes from the initialize reply. */
export async function freshList(which: LabName = "lab"): Promise<{ serverName: string; serverVersion: string; tools: Array<{ name: string; description?: string; inputSchema?: unknown; _meta?: Record<string, unknown> }> }> {
  const { McpHttpClient } = await import("./mcp-client.js");
  const c = new McpHttpClient(endpoints(which).mcp, null);
  const init = await c.initialize();
  const info = (init.body as { result?: { serverInfo?: { name?: unknown; version?: unknown } } }).result?.serverInfo;
  const tools = await c.listTools();
  return { serverName: String(info?.name ?? ""), serverVersion: String(info?.version ?? ""), tools };
}

/** Levenshtein distance, for "one character off" checks on a server name. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] ?? 0;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] ?? 0;
}
