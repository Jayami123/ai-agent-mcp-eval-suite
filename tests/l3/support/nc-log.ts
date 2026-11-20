import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { GREENMAIL_API } from "../../../src/oracles/greenmail.js";

// Nextcloud and GreenMail evidence for the APPR-002 mail cases. Captured inside the test, before the harness stops the containers
// (an always() CI step cannot exec into containers the harness has already removed). Every captured text is redacted first: a value
// that looks like a password, token, secret, cookie or header credential is blanked. A password is never printed or put on a command line.

const LOG = "/var/www/html/data/nextcloud.log";

/** Blanks the value of anything that looks like a password, token, secret, cookie or header credential. */
export function redactValues(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic ***")
    .replace(/((?:password|passwd|secret|token|authorization|cookie|api[_-]?key|x-api-key|set-cookie)"?\s*[:=]\s*"?)(?!(?:Bearer|Basic)\s)[^"\s,}&;]+/gi, "$1***");
}

/** The running Nextcloud app container's name, or undefined when there is none. */
export function appContainer(): string | undefined {
  const ps = spawnSync("docker", ["ps", "--filter", "name=nextcloud-app", "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 });
  return (ps.stdout ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 0);
}

/** occ as the web user (its normal user). Returns the exit code and the redacted output. Never throws. */
export function occAsWww(args: string[]): { status: number | null; out: string } {
  const name = appContainer();
  if (name === undefined) return { status: null, out: "no nextcloud-app container" };
  const r = spawnSync("docker", ["exec", "-u", "www-data", name, "php", "/var/www/html/occ", ...args], { encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: redactValues(`${r.stdout ?? ""}${r.stderr ?? ""}`).trim() };
}

/**
 * Sets a Nextcloud system value for this run only (the CI container is ephemeral). Used for loglevel 0 (debug) so the Mail app's
 * exceptions reach the log file. Returns what occ printed.
 */
export function setNextcloudSystemValue(key: string, value: string, type: "string" | "integer"): string {
  const r = occAsWww(["config:system:set", key, `--value=${value}`, `--type=${type}`]);
  return `config:system:set ${key} (exit ${r.status}): ${r.out}`;
}

/**
 * SMTP AUTH LOGIN from inside the Nextcloud app container to GreenMail (greenmail:3025). The login and password go in on stdin
 * (never on the command line or in a log). Only the three-digit reply codes are returned: the greeting, the AUTH step and the result.
 */
export function smtpAuthProbe(login: string, password: string): string {
  const name = appContainer();
  if (name === undefined) return "no nextcloud-app container";
  const script = [
    "read -r LOGIN",
    "read -r PW",
    "exec 3<>/dev/tcp/greenmail/3025",
    "read -t 10 -r l <&3; echo \"greeting ${l:0:3}\"",
    "printf 'EHLO probe\\r\\n' >&3",
    "while read -t 10 -r l <&3; do case \"$l\" in '250 '*) echo 'ehlo 250'; break;; *) echo \"ehlo ${l:0:3}\";; esac; done",
    "printf 'AUTH LOGIN\\r\\n' >&3; read -t 10 -r l <&3; echo \"auth-start ${l:0:3}\"",
    "printf '%s\\r\\n' \"$(printf %s \"$LOGIN\" | base64 -w0)\" >&3; read -t 10 -r l <&3; echo \"after-login ${l:0:3}\"",
    "printf '%s\\r\\n' \"$(printf %s \"$PW\" | base64 -w0)\" >&3; read -t 10 -r l <&3; echo \"auth-result ${l:0:3}\"",
    "printf 'QUIT\\r\\n' >&3",
  ].join("\n");
  const r = spawnSync("docker", ["exec", "-i", name, "bash", "-c", script], { input: `${login}\n${password}\n`, encoding: "utf8", timeout: 120_000 });
  return redactValues(`${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/[A-Za-z0-9+/=]{24,}/g, "***")).trim() + `\n(exit ${r.status})`;
}

/**
 * Creates a GreenMail user with a per-run password, for the SMTP AUTH probe only. The password is random, never printed, and the
 * user is a probe identity (not the owner's account). Returns the login and the password for the probe, nothing else.
 */
export async function createProbeUser(): Promise<{ login: string; password: string }> {
  const login = "qa-smtp-probe";
  const password = randomBytes(12).toString("hex");
  const res = await fetch(`${GREENMAIL_API}/api/user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, email: "qa-smtp-probe@p4.test", password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status >= 300) throw new Error(`GREENMAIL_PROBE_USER_HTTP_${res.status}`);
  return { login, password };
}

/**
 * The Mail app's outbox steps the Nextcloud app served after a given time: each POST or GET to the outbox routes with its status.
 * Read from the app container's own access log, so it is the server's record, not the client's.
 */
export function outboxSteps(sinceIso: string): string[] {
  const name = appContainer();
  if (name === undefined) return ["no nextcloud-app container"];
  const r = spawnSync("docker", ["logs", "--timestamps", "--since", sinceIso, name], { encoding: "utf8", timeout: 120_000 });
  const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => l.includes("/index.php/apps/mail/api/outbox"));
  return lines.map((l) => {
    const m = /"(GET|POST|PUT|DELETE) (\S+) HTTP\/1\.1" (\d{3})/.exec(l);
    return m === null ? l.slice(0, 120) : `${m[1]} ${m[2]} -> ${m[3]}`;
  });
}

/** Captures Nextcloud's log file (the path from occ log:file, last 400 lines), the app's own container logs, and any Mail log. */
export function captureNextcloudLog(dir: string, secrets: string[]): void {
  const name = appContainer();
  if (name === undefined) {
    writeEvidence(dir, "nextcloud-log-tail.txt", "no nextcloud-app container found when the stack stopped\n");
    return;
  }
  const exec = (script: string, extra: string[] = []) => spawnSync("docker", ["exec", name, "sh", "-c", script, "sh", ...extra], { encoding: "utf8", timeout: 120_000 });
  const clean = (r: { stdout?: string | null; stderr?: string | null }): string =>
    redactValues(redact(`${r.stdout ?? ""}${r.stderr ?? ""}`, secrets));

  // The log file occ reports (it may differ from the default), and its last 400 lines.
  const path = occAsWww(["log:file"]);
  const logFile = path.out.split("\n").map((s) => s.trim()).find((s) => s.startsWith("/")) ?? LOG;
  const tail = exec(`tail -n 400 "$1"`, [logFile]);
  writeEvidence(dir, "nextcloud-log-tail.txt", `container ${name}, occ log:file says: ${path.out}\nfile ${logFile}, exit ${tail.status}\n${clean(tail)}\n`);
  const smtp = exec(`tail -n 400 "$1" | grep -i -E 'mail|smtp' | tail -n 400`, [logFile]);
  writeEvidence(dir, "nextcloud-log-mail-smtp.txt", `file ${logFile}, exit ${smtp.status}\n${clean(smtp)}\n`);

  // Any other log the Mail app or Nextcloud writes (names and sizes first, then the tails).
  const found = exec(`find /var/www/html/data /var/www/html/config -maxdepth 2 -name '*.log' -exec ls -l {} \\; 2>/dev/null`);
  writeEvidence(dir, "nextcloud-other-logs.txt", `${clean(found)}\n`);

  // The app container's own stdout and stderr: Apache access lines and any PHP error printed there.
  const appLogs = spawnSync("docker", ["logs", "--tail", "400", name], { encoding: "utf8", timeout: 120_000 });
  writeEvidence(dir, "nextcloud-app-docker-logs.txt", `container ${name}, exit ${appLogs.status}\n${redactValues(redact(`${appLogs.stdout ?? ""}${appLogs.stderr ?? ""}`, secrets))}\n`);

  // The reachability of GreenMail from the app container (one greeting line from each port, read with a timeout).
  const reach = (port: number) => exec(`timeout 8 bash -c 'exec 3<>/dev/tcp/greenmail/${port} && read -t 6 -r line <&3 && echo "greeting: $line"'; echo "exit=$?"`);
  writeEvidence(dir, "nextcloud-to-greenmail.txt", `SMTP 3025: ${clean(reach(3025))}\nIMAP 3143: ${clean(reach(3143))}\n`);

  // The Nextcloud MCP server's and GreenMail's own logs.
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
