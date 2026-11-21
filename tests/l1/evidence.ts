import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Evidence helpers shared by the stack tests. Nothing here prints or writes a key, a token or a header value.

export function runId(): string {
  return process.env["GITHUB_RUN_ID"] ?? `local-${Date.now()}`;
}

export function writeEvidence(dir: string, name: string, text: string): void {
  const full = path.resolve(process.cwd(), "evidence", dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, name), text);
}

/** Removes known secret values and common key and token shapes before anything is written to evidence. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[REDACTED]");
  }
  return out
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]");
}

/** Tail of each matching container's log, redacted. Written even when the run failed. Never throws. */
export function collectContainerLogs(dir: string, nameFilters: string[], secrets: string[], tail = 400): void {
  try {
    for (const filter of nameFilters) {
      const ps = spawnSync("docker", ["ps", "-a", "--filter", `name=${filter}`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
      const names = (ps.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) {
        writeEvidence(dir, `${filter}-logs.txt`, `no ${filter} container found\n`);
        continue;
      }
      for (const name of names) {
        const logs = spawnSync("docker", ["logs", "--tail", String(tail), name], { encoding: "utf8", timeout: 60_000 });
        const text = `${logs.stdout ?? ""}${logs.stderr ?? ""}`;
        writeEvidence(dir, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.log`, `${redact(text, secrets)}\n`);
      }
    }
  } catch (err) {
    writeEvidence(dir, "log-collection-error.txt", `log collection failed: ${redact((err as Error).message, secrets)}\n`);
  }
}

/** The redacted log text of the first container whose name matches the filter ("" when none). For reading, not for evidence files. */
export function containerLogText(nameFilter: string, secrets: string[], tail = 400): string {
  const ps = spawnSync("docker", ["ps", "-a", "--filter", `name=${nameFilter}`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
  const name = (ps.stdout ?? "").split("\n").map((x) => x.trim()).find(Boolean);
  if (name === undefined) return "";
  const logs = spawnSync("docker", ["logs", "--tail", String(tail), name], { encoding: "utf8", timeout: 60_000 });
  return redact(`${logs.stdout ?? ""}${logs.stderr ?? ""}`, secrets);
}

/** The redacted, docker-timestamped LiteLLM log between sinceIso and untilIso (`docker logs --since --until --timestamps`). */
export function containerLogWindow(nameFilter: string, secrets: string[], sinceIso: string, untilIso: string): string {
  const ps = spawnSync("docker", ["ps", "-a", "--filter", `name=${nameFilter}`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
  const name = (ps.stdout ?? "").split("\n").map((x) => x.trim()).find(Boolean);
  if (name === undefined) return "";
  const logs = spawnSync("docker", ["logs", "--since", sinceIso, "--until", untilIso, "--timestamps", name], { encoding: "utf8", timeout: 60_000 });
  return redact(`${logs.stdout ?? ""}${logs.stderr ?? ""}`, secrets);
}
