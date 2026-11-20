import type { ServerOracle } from "./index.js";
import { makeSnapshot, type Snapshot } from "./snapshot.js";

// Outline oracle. Reads Outline's REST API (POST /api/<resource>.<action>, JSON) with a caller's own Authorization value,
// the owner's by default and the second user's where a case needs it. It never writes except through the explicit
// seed/cleanup helpers in tests/l3/support/seed/outline.ts. Every ID is discovered at run time; none is stored.

export interface OutlineApiReply {
  status: number;
  json: unknown;
}

/** Reads `data` from a reply, or undefined when the shape is not what the route documents. */
export function dataOf(reply: OutlineApiReply): unknown {
  const r = reply.json as { data?: unknown } | null;
  return r !== null && typeof r === "object" ? r.data : undefined;
}

export class OutlineOracle implements ServerOracle {
  readonly server = "outline" as const;

  /** `baseUrl` is the app origin (for example http://127.0.0.1:3011). `authorization` is the owner's full header value. */
  constructor(
    readonly baseUrl: string,
    readonly authorization: string,
  ) {}

  /** The app origin, derived from the MCP URL the harness wrote (the MCP is served at <origin>/mcp). */
  static originOf(mcpUrl: string): string {
    return mcpUrl.replace(/\/mcp\/?$/, "");
  }

  /** One REST call as the caller named by `authorization`. Returns the status and the parsed JSON (or undefined). */
  async api(authorization: string, route: string, body: Record<string, unknown> = {}): Promise<OutlineApiReply> {
    const res = await fetch(`${this.baseUrl}/api/${route}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  }

  /** Every page of a list route, read with the owner's token. Stops when a page comes back short. */
  async listAll(route: string, extra: Record<string, unknown> = {}): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let offset = 0; ; offset += 100) {
      const reply = await this.api(this.authorization, route, { ...extra, limit: 100, offset });
      if (reply.status !== 200) throw new Error(`OUTLINE_LIST_HTTP_${reply.status}: ${route}`);
      const page = dataOf(reply);
      if (!Array.isArray(page)) throw new Error(`OUTLINE_LIST_SHAPE: ${route} has no data array`);
      out.push(...page);
      if (page.length < 100) return out;
    }
  }

  /** Collections and documents as one snapshot. Only IDs, titles, collection links and publish state, plus a text digest. */
  async snapshot(): Promise<Snapshot> {
    const collections = (await this.listAll("collections.list")) as Array<Record<string, unknown>>;
    const documents = (await this.listAll("documents.list")) as Array<Record<string, unknown>>;
    const rows = {
      collections: collections.map((c) => ({ id: c["id"], name: c["name"], permission: c["permission"] ?? null })).sort(byId),
      documents: documents
        .map((d) => ({ id: d["id"], title: d["title"], collectionId: d["collectionId"] ?? null, publishedAt: d["publishedAt"] ?? null, updatedAt: d["updatedAt"], text: typeof d["text"] === "string" ? d["text"] : "" }))
        .sort(byId),
    };
    return makeSnapshot("outline", "collections+documents", rows, {
      collections: collections.length,
      documents: documents.length,
      titles: documents.map((d) => d["title"]).sort(),
    });
  }

  async close(): Promise<void> {
    // Stateless: nothing to close.
  }
}

function byId(a: { id: unknown }, b: { id: unknown }): number {
  return String(a.id).localeCompare(String(b.id));
}
