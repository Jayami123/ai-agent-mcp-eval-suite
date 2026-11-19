import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A new signing key per process. It is held in memory and never logged. */
export function createTokenKey(): Buffer {
  return randomBytes(32);
}

const b64 = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

export interface TokenClaims {
  aud: string;
  iss: string;
  scope?: string;
  /** Lifetime in seconds. A negative value makes an already expired token (for tests). Default 300. */
  ttlSec?: number;
}

/** HS256 JWT. Test use only. */
export function mintToken(key: Buffer, claims: TokenClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({ iss: claims.iss, aud: claims.aud, scope: claims.scope ?? "", iat: now, exp: now + (claims.ttlSec ?? 300) }),
  );
  const signature = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export type VerifyOk = { ok: true; aud: string; iss: string; fp: string };
export type VerifyResult = VerifyOk | { ok: false; reason: "missing" | "malformed" | "signature" | "expired" };

/** Checks the signature and expiry only. Audience and issuer are checked separately, so a mode can skip them. */
export function verifyToken(key: Buffer, header: string | undefined): VerifyResult {
  if (header === undefined || !header.startsWith("Bearer ")) return { ok: false, reason: "missing" };
  const token = header.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  const want = createHmac("sha256", key).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" };
  let claims: { aud?: unknown; iss?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as typeof claims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  const aud = typeof claims.aud === "string" ? claims.aud : "";
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  return { ok: true, aud, iss, fp: createHash("sha256").update(token).digest("hex").slice(0, 12) };
}

/** Strict check used by benign mode with auth on. wrong-audience mode skips it on purpose. */
export function audienceAndIssuerOk(v: VerifyOk, resource: string, issuer: string): "ok" | "audience" | "issuer" {
  if (v.aud !== resource) return "audience";
  if (v.iss !== issuer) return "issuer";
  return "ok";
}

/** RFC 9728 protected resource metadata. */
export function resourceMetadata(resource: string, issuer: string): Record<string, unknown> {
  return { resource, authorization_servers: [issuer], bearer_methods_supported: ["header"] };
}
