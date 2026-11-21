import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  isInitializeRequest,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { audienceAndIssuerOk, createTokenKey, resourceMetadata, verifyToken } from "./auth.js";
import { cancelledRequestId } from "./cancel.js";
import { createControlServer } from "./control.js";
import { toolsHash } from "./hash.js";
import { readBody, sendJson } from "./http-util.js";
import { APP_HTML, APP_MIME_TYPE, APP_RESOURCE_URI, buildTools, callTool, UnknownToolError, type LabConfig } from "./modes.js";
import { createSink, createSinkServer, type Sink } from "./sink.js";
import { LabState } from "./state.js";

export type ListenHost = "127.0.0.1" | "0.0.0.0";

/** Everything the HTTP and stdio transports share. */
export interface LabRuntime {
  state: LabState;
  sink: Sink;
  tokenKey: Buffer;
  controlToken: string;
  servers: Set<Server>;
  makeServer(): Server;
}

export function createRuntime(config: LabConfig, controlToken: string): LabRuntime {
  const state = new LabState(config);
  const sink = createSink();
  const servers = new Set<Server>();

  const makeServer = (): Server => {
    const server = new Server(
      { name: config.serverName, version: state.version, ...(config.serverTitle !== undefined ? { title: config.serverTitle } : {}) },
      { capabilities: { tools: { listChanged: true }, resources: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => {
      const tools = buildTools(state);
      state.record("tools_list", { count: tools.length, hash: toolsHash(tools) });
      return { tools: tools as unknown as Tool[] };
    });
    // The MCP Apps resource a tool's _meta.ui.resourceUri points at. Served in every mode (no tool list depends on it).
    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [{ uri: APP_RESOURCE_URI, name: "p4 lab view", mimeType: APP_MIME_TYPE }],
    }));
    server.setRequestHandler(ReadResourceRequestSchema, (request) => {
      if (request.params.uri !== APP_RESOURCE_URI) throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${request.params.uri}`);
      return { contents: [{ uri: APP_RESOURCE_URI, mimeType: APP_MIME_TYPE, text: APP_HTML }] };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const elicitation = server.getClientCapabilities()?.elicitation;
      try {
        const result = await callTool(state, request.params.name, request.params.arguments, {
          sink,
          signal: extra.signal,
          clientElicitation: {
            url: elicitation?.url !== undefined,
            form: elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined),
          },
          elicit: elicitation === undefined ? undefined : (params) => server.elicitInput(params as never) as never,
        });
        return result as never;
      } catch (err) {
        if (err instanceof UnknownToolError) throw new McpError(ErrorCode.InvalidParams, err.message);
        throw err;
      }
    });
    server.oninitialized = () => {
      const elicitation = server.getClientCapabilities()?.elicitation;
      state.record("initialize", {
        client: server.getClientVersion()?.name ?? "",
        elicitationForm: elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined),
        elicitationUrl: elicitation?.url !== undefined,
      });
    };
    server.onclose = () => {
      servers.delete(server);
    };
    servers.add(server);
    return server;
  };

  state.onToolsChanged = () => {
    for (const server of servers) void server.sendToolListChanged().catch(() => undefined);
  };
  return { state, sink, tokenKey: createTokenKey(), controlToken, servers, makeServer };
}

function listen(server: HttpServer, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export interface Ports {
  mcp?: number;
  control?: number;
  sink?: number;
}

export interface SideServers {
  controlUrl: string;
  sinkUrl: string;
  controlPort: number;
  sinkPort: number;
  close(): Promise<void>;
}

/** Starts the control and sink listeners and fills in the state's URLs. Used by both transports. */
export async function startSideServers(runtime: LabRuntime, host: ListenHost, ports: Ports, mcpUrl: string | undefined): Promise<SideServers> {
  const control = createControlServer({ state: runtime.state, sink: runtime.sink, token: runtime.controlToken, tokenKey: runtime.tokenKey });
  const sinkServer = createSinkServer(runtime.sink, { controlToken: runtime.controlToken });
  const controlPort = await listen(control, host, ports.control ?? 0);
  const sinkPort = await listen(sinkServer, host, ports.sink ?? 0);
  const controlUrl = `http://127.0.0.1:${String(controlPort)}`;
  const sinkUrl = `http://127.0.0.1:${String(sinkPort)}`;
  const cfg = runtime.state.config;
  runtime.state.urls = {
    resource: cfg.resource ?? mcpUrl ?? "",
    issuer: cfg.issuer ?? controlUrl,
    publicSink: cfg.publicSinkUrl ?? sinkUrl,
  };
  return {
    controlUrl,
    sinkUrl,
    controlPort,
    sinkPort,
    close: async () => {
      await Promise.all([closeServer(control), closeServer(sinkServer)]);
    },
  };
}

export interface RunningLab {
  mcpUrl: string;
  controlUrl: string;
  sinkUrl: string;
  controlToken: string;
  state: LabState;
  sink: Sink;
  close(): Promise<void>;
}

export interface CreateLabOptions {
  config: LabConfig;
  controlToken: string;
  host?: ListenHost;
  ports?: Ports;
}

export async function createLab(opts: CreateLabOptions): Promise<RunningLab> {
  const host = opts.host ?? "127.0.0.1";
  const runtime = createRuntime(opts.config, opts.controlToken);
  const { state } = runtime;
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();
  let allowedHosts = new Set<string>();

  const authRequired = (): boolean => state.config.auth || state.mode === "wrong-audience";
  const metadataUrl = (): string => {
    const resource = new URL(state.urls.resource);
    return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`;
  };
  const reject401 = (res: ServerResponse, reason: string): void => {
    sendJson(res, 401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${metadataUrl()}", error="invalid_token", error_description="${reason}"` });
  };

  /** Host and Origin must name this server (DNS-rebinding guard). Returns false after answering 403. */
  const hostChecked = (req: IncomingMessage, res: ServerResponse): boolean => {
    const hostHeader = (req.headers.host ?? "").toLowerCase();
    let originHost: string | null = null;
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = "";
      }
    }
    if (!allowedHosts.has(hostHeader) || (originHost !== null && !allowedHosts.has(originHost))) {
      sendJson(res, 403, { jsonrpc: "2.0", error: { code: -32000, message: "forbidden host or origin" }, id: null });
      return false;
    }
    return true;
  };

  const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostChecked(req, res)) return;
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (req.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) {
      sendJson(res, 200, resourceMetadata(state.urls.resource, state.urls.issuer));
      return;
    }
    if (path !== "/mcp") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (authRequired()) {
      const verified = verifyToken(runtime.tokenKey, req.headers["authorization"]);
      if (!verified.ok) {
        state.record("auth_rejected", { reason: verified.reason });
        reject401(res, verified.reason);
        return;
      }
      const verdict = audienceAndIssuerOk(verified, state.urls.resource, state.urls.issuer);
      if (state.mode === "wrong-audience") {
        // Deliberately vulnerable: signature and expiry only. The audience is logged, not enforced.
        state.record("auth_accepted", { aud: verified.aud, iss: verified.iss, fp: verified.fp, audMatches: verdict === "ok" });
      } else if (verdict !== "ok") {
        state.record("auth_rejected", { reason: verdict, fp: verified.fp });
        reject401(res, verdict);
        return;
      } else {
        state.record("auth_accepted", { aud: verified.aud, iss: verified.iss, fp: verified.fp, audMatches: true });
      }
    }

    const sessionId = typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined;
    const existing = sessionId !== undefined ? sessions.get(sessionId) : undefined;

    if (req.method === "POST") {
      const raw = await readBody(req, 1024 * 1024);
      if (raw === null) {
        sendJson(res, 413, { jsonrpc: "2.0", error: { code: -32600, message: "request too large" }, id: null });
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
        return;
      }
      // Only the request id is kept: a client may put any text in the reason.
      const cancelled = cancelledRequestId(body);
      if (cancelled !== undefined) state.record("cancelled_notification", { requestId: cancelled });
      if (existing !== undefined) {
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (sessionId === undefined && isInitializeRequest(body)) {
        const server = runtime.makeServer();
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      sendJson(res, sessionId === undefined ? 400 : 404, { jsonrpc: "2.0", error: { code: -32000, message: "no valid session" }, id: null });
      return;
    }
    if ((req.method === "GET" || req.method === "DELETE") && existing !== undefined) {
      await existing.transport.handleRequest(req, res);
      return;
    }
    sendJson(res, sessionId === undefined ? 400 : 404, { jsonrpc: "2.0", error: { code: -32000, message: "no valid session" }, id: null });
  };

  const mcp = createServer((req, res) => {
    handleMcp(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    });
  });
  const mcpPort = await listen(mcp, host, opts.ports?.mcp ?? 0);
  const mcpUrl = `http://127.0.0.1:${String(mcpPort)}/mcp`;
  allowedHosts = new Set([`127.0.0.1:${String(mcpPort)}`, `localhost:${String(mcpPort)}`, `[::1]:${String(mcpPort)}`, ...state.config.allowedHosts]);
  const side = await startSideServers(runtime, host, opts.ports ?? {}, mcpUrl);

  return {
    mcpUrl,
    controlUrl: side.controlUrl,
    sinkUrl: side.sinkUrl,
    controlToken: opts.controlToken,
    state,
    sink: runtime.sink,
    close: async () => {
      for (const { transport } of sessions.values()) await transport.close().catch(() => undefined);
      sessions.clear();
      await Promise.all([closeServer(mcp), side.close()]);
    },
  };
}
