// A small streamable-HTTP MCP client for the protocol cases (no model, no LibreChat). It keeps a wire log of every
// exchange for the recorder. The Authorization value is a secret: it is sent, never stored in the log or an error.

export interface WireEntry {
  dir: "out" | "in";
  status?: number;
  body: unknown;
}

export interface RpcResult {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  /** MCP Apps metadata (`_meta.ui.resourceUri`), when the server sends it. */
  _meta?: Record<string, unknown>;
}

/** Plain JSON, or an SSE body ("event: message\ndata: {...}"), or empty (a 202). Never echoes the text on failure. */
export function parseRpcBody(text: string): unknown {
  const t = text.trim();
  if (t === "") return {};
  const payload = t.startsWith("{") || t.startsWith("[") ? t : (t.split(/\r?\n/).find((l) => l.startsWith("data:")) ?? "").slice(5).trim();
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error("MCP_REPLY_NOT_JSON: reply is neither JSON nor an SSE data line (content not printed)");
  }
}

export class McpHttpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  readonly wire: WireEntry[] = [];

  constructor(
    private readonly url: string,
    private readonly authorization: string | null,
    private readonly protocolVersion = "2025-06-18",
  ) {}

  /** Raw POST. `extra` can override any header, which is how the header/body mismatch cases are written. */
  async post(body: unknown, extra: Record<string, string> = {}, withSession = true): Promise<RpcResult> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.authorization !== null) headers["authorization"] = this.authorization;
    if (withSession && this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;
    Object.assign(headers, extra);
    this.wire.push({ dir: "out", body });
    const res = await fetch(this.url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = parseRpcBody(text);
    } catch {
      parsed = { _unparsed: true };
    }
    this.wire.push({ dir: "in", status: res.status, body: parsed });
    return { status: res.status, headers: res.headers, body: parsed };
  }

  async initialize(): Promise<RpcResult> {
    const res = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: "p4-l3", version: "0" } } }, {}, false);
    this.sessionId = res.headers.get("mcp-session-id");
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return res;
  }

  async listTools(): Promise<ToolDef[]> {
    const res = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/list", params: {} });
    const tools = (res.body as { result?: { tools?: unknown } }).result?.tools;
    if (!Array.isArray(tools)) throw new Error(`MCP_TOOLS_LIST_SHAPE: HTTP ${res.status}, no result.tools array`);
    return tools as ToolDef[];
  }

  callTool(name: string, args: Record<string, unknown>): Promise<RpcResult> {
    return this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } });
  }
}
