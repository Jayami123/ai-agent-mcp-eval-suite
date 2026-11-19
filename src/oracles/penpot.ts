import { readFileSync } from "node:fs";
import path from "node:path";
import { createPgClient, type ProductAdapter } from "qa-portfolio-harness";
import type { ServerOracle } from "./index.js";
import { makeSnapshot, type Snapshot } from "./snapshot.js";

// Penpot oracle. Reads the product's own Postgres through the harness's read-only pool. The harness keeps the database
// password in the Penpot secrets file (not in dbUrl), so it is read from there and never printed. It never writes.
interface ReadOnlyPool {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

/** The password from the harness's per-run Penpot secrets file. Throws (without the value) when it is missing. */
export function penpotDbPassword(productRoot: string): string {
  const parsed = JSON.parse(readFileSync(path.join(productRoot, "secrets.json"), "utf8")) as { dbPassword?: unknown };
  if (typeof parsed.dbPassword !== "string" || parsed.dbPassword === "") throw new Error("PENPOT_ORACLE_NO_DB_PASSWORD: the secrets file has no dbPassword");
  return parsed.dbPassword;
}

export class PenpotOracle implements ServerOracle {
  readonly server = "penpot" as const;
  private pool: ReadOnlyPool | undefined;

  constructor(private readonly adapter: ProductAdapter) {}

  private db(): ReadOnlyPool {
    if (this.pool === undefined) {
      const url = new URL(this.adapter.dbUrl);
      url.password = penpotDbPassword(this.adapter.productRoot);
      this.pool = createPgClient(url.toString()) as unknown as ReadOnlyPool;
    }
    return this.pool;
  }

  /** Projects and files of the seeded owner's store, as one digest (ids, names and deletion marks, never file contents). */
  async snapshot(): Promise<Snapshot> {
    const projects = await this.db().query("SELECT id, name, deleted_at FROM project ORDER BY id");
    const files = await this.db().query("SELECT id, name, deleted_at FROM file ORDER BY id");
    return makeSnapshot("penpot", "projects+files", { projects: projects.rows, files: files.rows }, {
      projects: projects.rowCount ?? 0,
      files: files.rowCount ?? 0,
    });
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
