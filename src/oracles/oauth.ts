import { fail, pass, type Verdict } from "./verdict.js";

/** What an unauthenticated POST to the MCP URL returns. No token is sent, so nothing secret is involved. */
export interface Unauthenticated {
  status: number;
  wwwAuthenticate: string | null;
}

export async function probeUnauthenticated(mcpUrl: string): Promise<Unauthenticated> {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(30_000),
  });
  await res.arrayBuffer();
  return { status: res.status, wwwAuthenticate: res.headers.get("www-authenticate") };
}

/** The resource_metadata URL from a WWW-Authenticate header (RFC 9728), or null. */
export function resourceMetadataHint(header: string | null): string | null {
  const m = header === null ? null : /resource_metadata="?([^",\s]+)"?/i.exec(header);
  return m?.[1] ?? null;
}

/** RFC 9728 protected-resource metadata has a resource string and an authorization_servers array. */
export function metadataShapeViolations(doc: unknown): string[] {
  const d = doc as { resource?: unknown; authorization_servers?: unknown } | null;
  const out: string[] = [];
  if (typeof d?.resource !== "string") out.push("no resource string");
  if (!Array.isArray(d?.authorization_servers) || d.authorization_servers.length === 0) out.push("no authorization_servers");
  return out;
}

/** P4-MCP-OAUTH-001: 401, a resource-metadata hint in WWW-Authenticate, and a fetchable, well-formed metadata document. */
export async function metadataAdvertised(mcpUrl: string): Promise<Verdict[]> {
  const p = await probeUnauthenticated(mcpUrl);
  const verdicts: Verdict[] = [p.status === 401 ? pass("unauthenticated request got 401") : fail(`unauthenticated request got HTTP ${p.status}, not 401`)];
  const hint = resourceMetadataHint(p.wwwAuthenticate);
  if (hint === null) {
    verdicts.push(fail("401 carries no resource_metadata hint in WWW-Authenticate"));
    return verdicts;
  }
  verdicts.push(pass("WWW-Authenticate carries a resource_metadata hint"));
  const res = await fetch(hint, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [...verdicts, fail(`resource metadata URL answered HTTP ${res.status}`)];
  const bad = metadataShapeViolations(await res.json().catch(() => null));
  verdicts.push(bad.length === 0 ? pass("resource metadata is well formed") : fail(`resource metadata: ${bad.join(", ")}`));
  return verdicts;
}

/** Spike S3: the discovery documents an origin serves, status only. Written to evidence, never asserted. */
export async function discoveryStatuses(origin: string): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"]) {
    try {
      const r = await fetch(`${origin}${p}`, { signal: AbortSignal.timeout(15_000) });
      await r.arrayBuffer();
      out[p] = r.status;
    } catch (e) {
      out[p] = (e as Error).name;
    }
  }
  return out;
}
