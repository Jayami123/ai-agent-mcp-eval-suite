import { fail, pass, unverified, type Verdict } from "./verdict.js";

/** True when the JSON-RPC reply carries an error object (any code, or one of `codes`). The message text is not read. */
export function isJsonRpcError(body: unknown, codes?: number[]): Verdict {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code !== "number") return fail("reply has no JSON-RPC error");
  if (codes !== undefined && !codes.includes(code)) return fail(`JSON-RPC error code ${code} is not one of ${codes.join("|")}`);
  return pass(`JSON-RPC error code ${code}`);
}

/** A rejection is an HTTP 4xx or a JSON-RPC error. A 2xx with a result is a failure of the rejection. */
export function rejected(res: { status: number; body: unknown }): Verdict {
  if (res.status >= 400 && res.status < 500) return pass(`HTTP ${res.status}`);
  return isJsonRpcError(res.body);
}

/** A message as the wire log holds it (tests/l3/support/mcp-client.ts WireEntry has this shape). */
export interface WireMessage {
  dir: "out" | "in";
  status?: number;
  body: unknown;
}

const isId = (v: unknown): boolean => typeof v === "string" || typeof v === "number" || v === null;

/** Structural JSON-RPC 2.0 violations of one message. The message text is never copied into a violation. */
export function jsonRpcViolations(dir: "out" | "in", body: unknown): string[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ["message is not a JSON object"];
  const m = body as Record<string, unknown>;
  if ("_unparsed" in m) return ["message is not JSON"];
  if (Object.keys(m).length === 0) return []; // an empty body is a 202 to a notification
  const out: string[] = [];
  if (m["jsonrpc"] !== "2.0") out.push('jsonrpc is not "2.0"');
  if (dir === "out") {
    if (typeof m["method"] !== "string") out.push("request has no method string");
    if ("id" in m && !isId(m["id"])) out.push("request id is not a string or number");
    if ("params" in m && (typeof m["params"] !== "object" || m["params"] === null)) out.push("params is not an object or array");
    return out;
  }
  if (typeof m["method"] === "string") return out; // a server-initiated request or notification
  const hasResult = "result" in m;
  const hasError = "error" in m;
  if (hasResult === hasError) out.push("response must have exactly one of result or error");
  if (!isId(m["id"])) out.push("response id is not a string, number or null");
  if (hasError) {
    const e = m["error"] as { code?: unknown; message?: unknown } | null;
    if (typeof e?.code !== "number" || !Number.isInteger(e.code)) out.push("error.code is not an integer");
    if (typeof e?.message !== "string") out.push("error.message is not a string");
  }
  return out;
}

/** tools/list result shape: every tool has a name and an object inputSchema. */
export function toolsListViolations(result: unknown): string[] {
  const tools = (result as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return ["tools/list result has no tools array"];
  const out: string[] = [];
  tools.forEach((t, i) => {
    const tool = t as { name?: unknown; inputSchema?: { type?: unknown } } | null;
    if (typeof tool?.name !== "string" || tool.name === "") out.push(`tool ${i} has no name`);
    if (typeof tool?.inputSchema !== "object" || tool.inputSchema === null) out.push(`tool ${String(tool?.name ?? i)} has no inputSchema object`);
  });
  return out;
}

/** Every logged message must be valid. An empty log is unverified-by-construction and fails: nothing was recorded. */
export function noSchemaViolations(wire: WireMessage[]): Verdict {
  if (wire.length === 0) return fail("the wire log is empty");
  const bad: string[] = [];
  wire.forEach((w, i) => {
    if (w.dir === "in" && w.status !== undefined && w.status >= 400) return; // HTTP-level rejection, not a JSON-RPC exchange
    for (const v of jsonRpcViolations(w.dir, w.body)) bad.push(`#${i} ${w.dir}: ${v}`);
  });
  return bad.length === 0 ? pass(`${wire.length} messages valid`) : fail(bad.slice(0, 5).join("; "));
}

/** A clean outcome is an answer, not a crash: HTTP below 500 and either a result or a JSON-RPC error or a 4xx. */
export function cleanResponse(res: { status: number; body: unknown }): Verdict {
  if (res.status >= 500) return fail(`HTTP ${res.status}`);
  const b = res.body as { result?: unknown; error?: unknown } | null;
  if (typeof b === "object" && b !== null && ("result" in b || "error" in b)) return pass(`HTTP ${res.status} with ${"result" in b ? "result" : "error"}`);
  return res.status >= 400 ? pass(`HTTP ${res.status}`) : fail(`HTTP ${res.status} with neither result nor error`);
}

/**
 * Stateless claim: when initialize sets no session id the server claims to be stateless, so a bare tools/list must
 * answer with a result. A stateful server must refuse a bare call cleanly. Either way never a 5xx.
 */
export function statelessClaimHolds(init: { headers: Headers }, bare: { status: number; body: unknown }): Verdict {
  const clean = cleanResponse(bare);
  if (clean.outcome !== "pass") return clean;
  const stateless = init.headers.get("mcp-session-id") === null;
  const hasResult = (bare.body as { result?: unknown } | null)?.result !== undefined;
  if (stateless) return hasResult ? pass("stateless server answered a bare call") : fail("initialize set no session id, yet a bare call was refused");
  return hasResult ? fail("stateful server (session id issued) answered a bare call") : pass("stateful server refused a bare call cleanly");
}

/** Version negotiation: an unsupported requested version is an error or a downgrade to a different version. */
export function versionRejectedOrDowngraded(res: { status: number; body: unknown }, requested: string): Verdict {
  if (res.status >= 500) return fail(`HTTP ${res.status}`);
  const b = res.body as { result?: { protocolVersion?: unknown }; error?: unknown } | null;
  if (b?.error !== undefined || res.status >= 400) return pass("unsupported version refused");
  const got = b?.result?.protocolVersion;
  if (typeof got === "string" && got !== requested) return pass(`downgraded to ${got}`);
  return fail("server accepted an unsupported protocol version unchanged");
}

/** The first spec revision that defines the Mcp-Method header rule. Dates compare as plain ISO strings. */
export const HEADER_RULE_SPEC = "2026-07-28";

/**
 * P4-MCP-PROT-003. A header that disagrees with the body must be refused (JSON-RPC -32020 HeaderMismatch, or HTTP 4xx) by a
 * server that negotiated spec 2026-07-28 or later. A server that negotiated an earlier revision is not bound by a rule that
 * does not exist in it: acceptance there is a spec-version gap, reported as a deployment finding, and the verdict passes.
 * An unknown negotiated version cannot be classified and fails.
 */
export function headerMismatchRefused(res: { status: number; body: unknown }, negotiated?: string): Verdict {
  const code = (res.body as { error?: { code?: unknown } } | null)?.error?.code;
  if (code === -32020) return pass("JSON-RPC -32020 HeaderMismatch");
  if (res.status >= 400 && res.status < 500) return pass(`HTTP ${res.status}`);
  if (typeof code === "number") return pass(`JSON-RPC error ${code}`);
  if (negotiated === undefined) return fail(`mismatched Mcp-Method header was accepted (HTTP ${res.status}) and no negotiated version is known`);
  if (negotiated < HEADER_RULE_SPEC) {
    return pass(`deployment finding: server negotiated ${negotiated}, which predates the Mcp-Method rule of ${HEADER_RULE_SPEC}; mismatch accepted (HTTP ${res.status})`);
  }
  return fail(`server negotiated ${negotiated} but accepted a mismatched Mcp-Method header (HTTP ${res.status})`);
}

/**
 * P4-MCP-PROT-011. The tasks extension is either negotiated (the server advertises the `tasks` capability at initialize) or
 * cleanly absent (the server does not advertise it, and tasks/get is refused with a JSON-RPC error and no result). An absent
 * capability with a tasks/get result is a failure. An advertised capability needs the create-and-read leg, which this PR does
 * not build, so it is unverified rather than passed.
 */
export function tasksCapabilityConsistent(init: { body: unknown }, tasksGet: { status: number; body: unknown }): Verdict {
  if (tasksGet.status >= 500) return fail(`tasks/get answered HTTP ${tasksGet.status}`);
  const caps = (init.body as { result?: { capabilities?: unknown } } | null)?.result?.capabilities as Record<string, unknown> | undefined;
  const advertised = typeof caps === "object" && caps !== null && "tasks" in caps;
  const b = tasksGet.body as { result?: unknown; error?: { code?: unknown } } | null;
  if (advertised) return unverified("tasks capability advertised; the create-and-read leg is not built in this PR");
  if (b?.result !== undefined) return fail("tasks/get returned a result although the server did not advertise the tasks capability");
  if (typeof b?.error?.code === "number") return pass(`tasks not advertised; tasks/get refused with JSON-RPC ${b.error.code}`);
  return fail(`tasks not advertised and tasks/get gave neither a result nor a JSON-RPC error (HTTP ${tasksGet.status})`);
}
