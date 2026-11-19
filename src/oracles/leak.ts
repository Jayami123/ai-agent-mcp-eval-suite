import fs from "node:fs";
import path from "node:path";

// Leak check for evidence. After a run, every file under evidence/ is read and searched for each secret value the run held
// (the LibreChat bearer token, the MCP credentials) and for shapes of secrets that must never be written (a Bearer value, an
// API key). The result names the files and the kind of match, never the matched text.

export interface LeakHit {
  file: string;
  kind: "secret-value" | "bearer-value" | "api-key-shape";
}

const SHAPES: Array<{ kind: LeakHit["kind"]; re: RegExp }> = [
  // "Bearer [REDACTED]" is the redacted form and is allowed.
  { kind: "bearer-value", re: /Bearer\s+(?!\[REDACTED\]|\[redacted\])[A-Za-z0-9._~+/=-]{16,}/ },
  { kind: "api-key-shape", re: /(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})/ },
];

/** Hits in one text. `secrets` shorter than 8 characters are ignored (too short to identify). */
export function leaksIn(text: string, secrets: readonly string[]): Array<LeakHit["kind"]> {
  const out: Array<LeakHit["kind"]> = [];
  if (secrets.some((s) => s.length >= 8 && text.includes(s))) out.push("secret-value");
  for (const { kind, re } of SHAPES) if (re.test(text)) out.push(kind);
  return out;
}

const TEXT_EXT = new Set([".json", ".txt", ".log", ".md", ".yml", ".yaml", ".csv"]);

/** Every text file under `dir` (recursive) that holds a secret or a secret shape. Binary files (screenshots) are skipped. */
export function scanDir(dir: string, secrets: readonly string[]): LeakHit[] {
  const hits: LeakHit[] = [];
  if (!fs.existsSync(dir)) return hits;
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (TEXT_EXT.has(path.extname(e.name))) for (const kind of leaksIn(fs.readFileSync(full, "utf8"), secrets)) hits.push({ file: path.relative(dir, full), kind });
    }
  };
  walk(dir);
  return hits;
}
