import fs from "node:fs";
import { getAdapter, type AuthSession, type ProductAdapter } from "qa-portfolio-harness";
import type { ServerId } from "../../../src/oracles/snapshot.js";
import { collectContainerLogs, redact } from "../../l1/evidence.js";
import { STUB_UPSTREAM_URL } from "../../l1/stub-recorder.js";
import { LAB } from "./lab.js";

export type BusinessServer = Exclude<ServerId, "lab">;
/** A server the stack can carry: a harness product, or the attack-lab (an L2 container, not a harness adapter). */
export type StackServer = BusinessServer | "lab";

/** CI runs one job per server and sets P4_L3_SERVERS to it, so a cross-server file starts only that server's stack. */
export function selectServers<T extends string>(registered: T[]): T[] {
  const raw = process.env["P4_L3_SERVERS"];
  if (raw === undefined || raw.trim() === "") return registered;
  const want = raw.split(",").map((s) => s.trim());
  return registered.filter((s) => want.includes(s));
}

export interface McpEndpoint {
  url: string;
  /** Full Authorization header value, or null when the server takes none (Penpot). A secret: never print it. */
  authorization: string | null;
}

export interface L3Stack {
  session: AuthSession;
  adapters: ReadonlyMap<BusinessServer, ProductAdapter>;
  mcp(server: StackServer): McpEndpoint;
  secrets(): string[];
  stop(): Promise<void>;
}

/** The credential the harness wrote for one server. The harness does not export its reader, so the suite parses the file. */
function readRunState(adapter: ProductAdapter): McpEndpoint {
  const file = adapter.mcpRunStateFile?.();
  if (file === undefined) throw new Error(`L3_NO_RUN_STATE: the ${adapter.id} adapter has no mcpRunStateFile (harness too old)`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpUrl?: unknown; mcpAuthorization?: unknown };
  if (typeof parsed.mcpUrl !== "string") throw new Error(`L3_RUN_STATE_SHAPE: ${adapter.id} run state has no mcpUrl (content not printed)`);
  return { url: parsed.mcpUrl, authorization: typeof parsed.mcpAuthorization === "string" ? parsed.mcpAuthorization : null };
}

/**
 * Brings up the named servers, LiteLLM and LibreChat through the harness, in that order, and returns what a test needs.
 * The harness owns start and stop: this only calls the adapters, as tests/l1 does. Config is read once by the harness, so
 * every setting goes into process.env before the first getAdapter call.
 */
export async function startStack(servers: StackServer[], dir: string): Promise<L3Stack> {
  const nightly = process.env["P4_LLM_MODE"] === "nightly";
  const businessServers = servers.filter((s): s is BusinessServer => s !== "lab");
  process.env["LIBRECHAT_MCP_PRODUCTS"] = servers.join(",");
  if (servers.includes("twenty")) process.env["TWENTY_MCP"] = "1";
  // The attack-lab is a container started outside the harness (npm run lab:up, or the CI step). It must answer before
  // LibreChat starts, because LibreChat connects its MCP servers at boot.
  if (servers.includes("lab")) await assertLabUp();
  if (nightly) delete process.env["P4_STUB_API_BASE"];
  else {
    process.env["P4_LLM_MODE"] = "stub";
    process.env["P4_STUB_API_BASE"] = STUB_UPSTREAM_URL;
    delete process.env["GEMINI_API_KEY"];
  }
  const adapters = new Map<BusinessServer, ProductAdapter>(businessServers.map((s) => [s, getAdapter(s)]));
  const litellm = getAdapter("litellm");
  const librechat = getAdapter("librechat");
  let session: AuthSession | undefined;
  const secrets = (): string[] => (session ? [session.authorizationHeader] : []);
  const stop = async (): Promise<void> => {
    collectContainerLogs(dir, ["litellm", "librechat", "p4-suite-stub", ...(servers.includes("lab") ? ["attack-lab"] : [])], secrets());
    for (const a of [librechat, litellm, ...[...adapters.values()].reverse()]) {
      await a.down().catch((e: unknown) => console.error(`${a.id} down failed: ${redact((e as Error).message, secrets())}`));
    }
  };
  try {
    for (const a of adapters.values()) {
      await a.up();
      if (a.id === "twenty") {
        if (!a.waitMcp) throw new Error("TWENTY_ADAPTER_NO_MCP: harness Twenty adapter has no waitMcp");
        await a.waitMcp();
      }
    }
    await litellm.up();
    await librechat.up();
    session = await librechat.authenticate();
  } catch (err) {
    await stop();
    throw err;
  }
  const mcp = (s: StackServer): McpEndpoint => (s === "lab" ? { url: LAB.mcp, authorization: null } : readRunState(adapters.get(s) as ProductAdapter));
  return { session, adapters, mcp, secrets, stop };
}

/** The lab must answer on its loopback MCP port and its control port before LibreChat is started. Names no secret. */
async function assertLabUp(): Promise<void> {
  const res = await fetch(LAB.mcp.replace(/\/mcp$/, "/.well-known/oauth-protected-resource/mcp"), { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  if (res === undefined || !res.ok) throw new Error("L3_LAB_NOT_UP: the attack-lab does not answer on its MCP port (run npm run lab:up first)");
}
