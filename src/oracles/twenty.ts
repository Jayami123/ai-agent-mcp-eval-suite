import { createPgClient, twentyMailApiUrl, type ProductAdapter } from "qa-portfolio-harness";
import { makeSnapshot, type Snapshot } from "./snapshot.js";
import type { ServerOracle } from "./index.js";
import { fail, pass, type Verdict } from "./verdict.js";

// Twenty oracle. Reads the product's own Postgres through the harness's read-only pool (createPgClient sets
// default_transaction_read_only=on), and the Mailpit catcher the Twenty stack already runs. It never writes.
// UNVERIFIED until spike S2: the schema and table names below. S2 prints them with \dt and fixes this list.
const TABLES = ["person", "company", "opportunity", "note"] as const;
const IDENT = /^[a-z0-9_]+$/;

/** The part of pg.Pool the oracle uses. The harness types come from `pg`, which the suite does not install, so this is local. */
interface ReadOnlyPool {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export class TwentyOracle implements ServerOracle {
  readonly server = "twenty" as const;
  private readonly pool: ReadOnlyPool;

  constructor(adapter: ProductAdapter) {
    this.pool = createPgClient(adapter.dbUrl) as unknown as ReadOnlyPool;
  }

  snapshot(): Promise<Snapshot> {
    return this.records();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Workspace schemas Twenty created. Names come from information_schema and are checked before use as identifiers. */
  async workspaceSchemas(): Promise<string[]> {
    const res = await this.pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'workspace\\_%' ORDER BY schema_name",
    );
    return res.rows.map((r) => String(r["schema_name"])).filter((n) => IDENT.test(n));
  }

  /** Table names found in one schema, for the S2 capture. Written to evidence, never asserted. */
  async tablesIn(schema: string): Promise<string[]> {
    if (!IDENT.test(schema)) throw new Error("TWENTY_ORACLE_BAD_SCHEMA: schema name failed the identifier check");
    const res = await this.pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`);
    return res.rows.map((r) => String(r["table_name"]));
  }

  /**
   * People, companies, opportunities and notes of one workspace (default: every workspace), as one snapshot. A table that
   * does not exist is left out and named in the summary; the oracle fails if it finds none at all.
   */
  async records(schemas?: string[]): Promise<Snapshot> {
    const list = schemas ?? (await this.workspaceSchemas());
    const rows: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const schema of list) {
      const present = new Set(await this.tablesIn(schema));
      for (const table of TABLES) {
        if (!present.has(table)) continue;
        const res = await this.pool.query(`SELECT * FROM "${schema}"."${table}" ORDER BY id`);
        rows[`${schema}.${table}`] = res.rows;
        counts[`${schema}.${table}`] = res.rowCount ?? 0;
      }
    }
    if (Object.keys(rows).length === 0) throw new Error(`TWENTY_ORACLE_NO_TABLES: none of ${TABLES.join(", ")} found in ${list.length} workspace schema(s); S2 capture lists the real names`);
    return makeSnapshot("twenty", `records:${list.join("+")}`, rows, { counts });
  }
}

/** Number of caught messages addressed to `address`. UNVERIFIED until S2: the Mailpit search route and count field. */
export async function mailCountTo(address: string): Promise<number> {
  const res = await fetch(`${twentyMailApiUrl}/search?query=${encodeURIComponent(`to:${address}`)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`TWENTY_MAILPIT_HTTP_${res.status}`);
  const body = (await res.json()) as { messages_count?: unknown; messages?: unknown[] };
  if (typeof body.messages_count === "number") return body.messages_count;
  if (Array.isArray(body.messages)) return body.messages.length;
  throw new Error("TWENTY_MAILPIT_SHAPE: no messages_count or messages in the search reply");
}

export function mailEmpty(count: number, address: string): Verdict {
  return count === 0 ? pass(`0 caught messages to ${address}`) : fail(`${count} caught message(s) to ${address}`);
}
