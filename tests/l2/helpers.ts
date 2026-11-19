import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { configFromEnv, type LabConfig } from "../../src/attack-lab/modes.js";
import { createLab, type RunningLab } from "../../src/attack-lab/server.js";

/** Not a secret: a fixed token for in-process test labs that only listen on 127.0.0.1. */
export const TEST_CONTROL_TOKEN = "test-control-token-0000";

export interface LabHandle extends RunningLab {
  /** Calls a control route with the test token. */
  control(path: string, init?: { method?: string; body?: unknown; token?: string | null }): Promise<Response>;
  /** Log events, in order, for a quick assertion. */
  events(): string[];
}

/** Starts a lab on 127.0.0.1 with ephemeral ports. Overrides win over the defaults from configFromEnv({}). */
export async function startLab(overrides: Partial<LabConfig> = {}): Promise<LabHandle> {
  const config: LabConfig = { ...configFromEnv({}), ...overrides };
  const lab = await createLab({ config, controlToken: TEST_CONTROL_TOKEN });
  return {
    ...lab,
    control: (path, init = {}) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (init.token !== null) headers["authorization"] = `Bearer ${init.token ?? TEST_CONTROL_TOKEN}`;
      return fetch(`${lab.controlUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    },
    events: () => lab.state.log.map((entry) => entry.event),
  };
}

/** SDK client over streamable HTTP. Pass capabilities to declare elicitation; pass a token for an auth-on lab. */
export async function connect(lab: { mcpUrl: string }, capabilities: ClientCapabilities = {}, opts: { token?: string } = {}): Promise<Client> {
  const client = new Client({ name: "l2-test-client", version: "0.0.0" }, { capabilities });
  const transport = new StreamableHTTPClientTransport(new URL(lab.mcpUrl), {
    ...(opts.token !== undefined ? { requestInit: { headers: { authorization: `Bearer ${opts.token}` } } } : {}),
  });
  await client.connect(transport);
  return client;
}

export interface RpcResult {
  status: number;
  json: any;
  session: string | undefined;
}

/** Raw JSON-RPC over POST, for results the SDK client would refuse. Pass the session from a previous call. */
export async function rpc(lab: { mcpUrl: string }, method: string, params: unknown, session?: string, token?: string): Promise<RpcResult> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (session !== undefined) headers["mcp-session-id"] = session;
  if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(lab.mcpUrl, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const raw = await res.text();
  let json: any = null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = raw.split("\n").find((line) => line.startsWith("data: "));
    json = data === undefined ? null : JSON.parse(data.slice(6));
  } else if (raw !== "") {
    json = JSON.parse(raw);
  }
  return { status: res.status, json, session: res.headers.get("mcp-session-id") ?? session };
}

/** initialize over raw HTTP; returns the session id. */
export async function rawInitialize(lab: { mcpUrl: string }, token?: string): Promise<string> {
  const r = await rpc(lab, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "0" } }, undefined, token);
  if (r.session === undefined) throw new Error(`initialize failed with status ${String(r.status)}`);
  return r.session;
}

/** Text of the first content block of a callTool result. */
export function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: unknown }> }).content ?? [];
  const text = content[0]?.text;
  return typeof text === "string" ? text : "";
}
