import { spawnSync } from "node:child_process";
import { redact, writeEvidence } from "../../l1/evidence.js";

// Captures Nextcloud's own log before the stack is torn down (the harness stops containers in stack.stop(), so an
// always() CI step cannot exec into them). Writes the last 300 lines and the Mail/SMTP lines to the run's evidence directory.
// Values that look like a credential are redacted before anything is written.

const LOG = "/var/www/html/data/nextcloud.log";

/** Blanks the value of anything that looks like a password, token, secret, cookie or header credential. */
export function redactValues(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic ***")
    .replace(/((?:password|passwd|secret|token|authorization|cookie|api[_-]?key|x-api-key|set-cookie)"?\s*[:=]\s*"?)(?!(?:Bearer|Basic)\s)[^"\s,}&;]+/gi, "$1***");
}

export function captureNextcloudLog(dir: string, secrets: string[]): void {
  const ps = spawnSync("docker", ["ps", "--filter", "name=nextcloud-app", "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
  const name = (ps.stdout ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 0);
  if (name === undefined) {
    writeEvidence(dir, "nextcloud-log-tail.txt", "no nextcloud-app container found when the stack stopped\n");
    return;
  }
  const exec = (script: string) => spawnSync("docker", ["exec", name, "sh", "-c", script], { encoding: "utf8", timeout: 120_000 });
  const tail = exec(`tail -n 300 ${LOG}`);
  const smtp = exec(`tail -n 300 ${LOG} | grep -i -E 'mail|smtp' | tail -n 300`);
  const clean = (r: { stdout?: string | null; stderr?: string | null; status: number | null }): string =>
    `${redactValues(redact(`${r.stdout ?? ""}${r.stderr ?? ""}`, secrets))}\n`;
  writeEvidence(dir, "nextcloud-log-tail.txt", `container ${name}, file ${LOG}, exit ${tail.status}\n${clean(tail)}`);
  writeEvidence(dir, "nextcloud-log-mail-smtp.txt", `container ${name}, file ${LOG}, exit ${smtp.status}\n${clean(smtp)}`);
  // Can the Nextcloud app container reach GreenMail, and what does its SMTP and IMAP listener say? The greeting is the server's
  // first line only (no credential is sent). Also the log settings that decide where Nextcloud writes its exceptions.
  // One greeting line, read with a timeout (a greeting is shorter than a fixed byte count, so a byte-count read cannot finish).
  const reach = (port: number) => exec(`timeout 8 bash -c 'exec 3<>/dev/tcp/greenmail/${port} && read -t 6 -r line <&3 && echo "greeting: $line"'; echo "exit=$?"`);
  const smtpReach = reach(3025);
  const imapReach = reach(3143);
  // occ runs as the web user, which is how Nextcloud expects it; each key is read on its own so a failure names itself.
  const occ = (key: string) => {
    const r = spawnSync("docker", ["exec", "-u", "www-data", name, "php", "/var/www/html/occ", "config:system:get", key], { encoding: "utf8", timeout: 120_000 });
    return `${key} (exit ${r.status}): ${redactValues(redact(`${r.stdout ?? ""}${r.stderr ?? ""}`, secrets)).trim()}`;
  };
  const logCfg = { stdout: [occ("log_type"), occ("loglevel"), occ("logfile")].join("\n"), stderr: "", status: 0 };
  writeEvidence(dir, "nextcloud-to-greenmail.txt", `SMTP 3025 from app: ${redactValues(redact(`${smtpReach.stdout ?? ""}${smtpReach.stderr ?? ""}`, secrets))}\nIMAP 3143 from app: ${redactValues(redact(`${imapReach.stdout ?? ""}${imapReach.stderr ?? ""}`, secrets))}\nlog settings (log_type, loglevel, logfile):\n${redactValues(redact(`${logCfg.stdout ?? ""}${logCfg.stderr ?? ""}`, secrets))}\n`);
  // The Nextcloud app container's own stdout and stderr: the Mail app's exception is written there when it is not in nextcloud.log.
  const appLogs = spawnSync("docker", ["logs", "--tail", "400", name], { encoding: "utf8", timeout: 120_000 });
  writeEvidence(dir, "nextcloud-app-docker-logs.txt", `container ${name}, exit ${appLogs.status}\n${redactValues(redact(`${appLogs.stdout ?? ""}${appLogs.stderr ?? ""}`, secrets))}\n`);
  // The 500 may be produced below Nextcloud's own log: the Nextcloud MCP server and GreenMail (the SMTP server) keep their own logs.
  for (const filter of ["nextcloud-mcp", "greenmail"]) {
    const ps2 = spawnSync("docker", ["ps", "-a", "--filter", `name=${filter}`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
    const names = (ps2.stdout ?? "").split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
    if (names.length === 0) {
      writeEvidence(dir, `${filter}-logs-tail.txt`, `no ${filter} container found\n`);
      continue;
    }
    for (const c of names) {
      const logs = spawnSync("docker", ["logs", "--tail", "300", c], { encoding: "utf8", timeout: 120_000 });
      writeEvidence(dir, `${filter}-logs-tail.txt`, `container ${c}, exit ${logs.status}\n${redactValues(redact(`${logs.stdout ?? ""}${logs.stderr ?? ""}`, secrets))}\n`);
    }
  }
}
