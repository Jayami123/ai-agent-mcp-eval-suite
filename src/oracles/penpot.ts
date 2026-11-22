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

  /**
   * The revision of every live file: `revn` (the file's change counter, bumped by every edit) and `modified_at`. Content is
   * never read, so a digest of these rows moves when a design changes and stays put when a file is only exported or read.
   */
  async fileRevisions(): Promise<Snapshot> {
    const files = await this.db().query("SELECT id, revn, modified_at FROM file WHERE deleted_at IS NULL ORDER BY id");
    // The summary names each file's revn and modified_at (ids and counters only, no content), so a failed "unchanged" check says
    // which column moved. The digest is still over the rows.
    const revisions = files.rows.map((r) => ({ id: String(r.id), revn: Number(r.revn), modified_at: String(r.modified_at) }));
    return makeSnapshot("penpot", "file revisions", files.rows, { files: files.rowCount ?? 0, revisions });
  }

  /**
   * The change rows (file_change) of the live files, newest first, as metadata only: file name, revn, created_at, session_id,
   * profile_id, and the byte sizes of the stored changes and data blobs. The blobs are never selected. Decoding the change types
   * needs Penpot's blob decoder (backend/src/app/util/blob.clj, LZ4 frame around fressian), which this oracle does not ship.
   */
  async fileChangeRows(): Promise<
    Array<{ file: string; revn: number; created_at: string; session_id: string | null; profile_id: string | null; changes_bytes: number | null; data_bytes: number | null }>
  > {
    const res = await this.db().query(
      "SELECT f.name AS file, c.revn AS revn, c.created_at AS created_at, c.session_id AS session_id, c.profile_id AS profile_id, octet_length(c.changes) AS changes_bytes, octet_length(c.data) AS data_bytes FROM file_change c JOIN file f ON f.id = c.file_id WHERE f.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 200",
    );
    const nul = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
    const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    return res.rows.map((r) => ({
      file: String(r["file"]),
      revn: Number(r["revn"]),
      created_at: String(r["created_at"]),
      session_id: nul(r["session_id"]),
      profile_id: nul(r["profile_id"]),
      changes_bytes: num(r["changes_bytes"]),
      data_bytes: num(r["data_bytes"]),
    }));
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
