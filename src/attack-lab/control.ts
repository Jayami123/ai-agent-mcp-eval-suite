import { createServer, type Server } from "node:http";
import { mintToken } from "./auth.js";
import { toolHash, toolsHash } from "./hash.js";
import { bearerMatches, readBody, sendJson } from "./http-util.js";
import { buildTools, isLabMode } from "./modes.js";
import type { Sink } from "./sink.js";
import { NoTriggerError, type LabState } from "./state.js";

export interface ControlDeps {
  state: LabState;
  sink: Sink;
  token: string;
  tokenKey: Buffer;
}

/** The control API. Not an MCP tool. Every route needs the per-run bearer token. The caller calls listen(). */
export function createControlServer(deps: ControlDeps): Server {
  const { state, sink } = deps;
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (!bearerMatches(req.headers["authorization"], deps.token)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const method = req.method ?? "";

      if (method === "GET" && path === "/control/state") {
        const tools = buildTools(state);
        sendJson(res, 200, {
          mode: state.mode,
          version: state.version,
          triggered: state.triggered,
          successfulCalls: state.successfulCalls,
          toolsHash: toolsHash(tools),
          tools: tools.map((tool) => ({ name: tool.name, hash: toolHash(tool) })),
        });
        return;
      }
      if (method === "GET" && path === "/control/log") {
        sendJson(res, 200, { entries: state.log });
        return;
      }
      if (method === "POST" && path === "/control/trigger") {
        try {
          state.trigger();
        } catch (err) {
          if (err instanceof NoTriggerError) {
            sendJson(res, 409, { error: err.message });
            return;
          }
          throw err;
        }
        sendJson(res, 200, { mode: state.mode, version: state.version, triggered: state.triggered });
        return;
      }
      if (method === "POST" && path === "/control/reset") {
        state.reset();
        sink.clear();
        sendJson(res, 200, { mode: state.mode, version: state.version, triggered: state.triggered });
        return;
      }
      if (method === "POST" && (path === "/control/mode" || path === "/control/mint-token")) {
        const raw = await readBody(req, 64 * 1024);
        if (raw === null) {
          sendJson(res, 413, { error: "too large" });
          return;
        }
        let body: Record<string, unknown>;
        try {
          const parsed: unknown = raw === "" ? {} : JSON.parse(raw);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          body = parsed as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        if (path === "/control/mode") {
          const mode = body["mode"];
          if (typeof mode !== "string" || !isLabMode(mode)) {
            sendJson(res, 400, { error: "unknown mode" });
            return;
          }
          state.setMode(mode);
          sendJson(res, 200, { mode: state.mode, version: state.version, triggered: state.triggered });
          return;
        }
        const aud = body["aud"];
        if (typeof aud !== "string" || aud === "") {
          sendJson(res, 400, { error: "aud is required" });
          return;
        }
        const iss = typeof body["iss"] === "string" ? body["iss"] : state.urls.issuer;
        const scope = typeof body["scope"] === "string" ? body["scope"] : undefined;
        const ttlSec = typeof body["ttlSec"] === "number" ? body["ttlSec"] : undefined;
        sendJson(res, 200, { token: mintToken(deps.tokenKey, { aud, iss, ...(scope !== undefined ? { scope } : {}), ...(ttlSec !== undefined ? { ttlSec } : {}) }) });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
  });
}

