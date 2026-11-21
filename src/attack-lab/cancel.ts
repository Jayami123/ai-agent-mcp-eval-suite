/**
 * The request id of a JSON-RPC `notifications/cancelled` message, or undefined for any other body. Pure: the server calls it on
 * every POST body and records the id (never the reason text, which a client may fill with anything).
 */
export function cancelledRequestId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const msg = body as { method?: unknown; params?: unknown };
  if (msg.method !== "notifications/cancelled") return undefined;
  const requestId = (msg.params as { requestId?: unknown } | undefined)?.requestId;
  if (typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128) return requestId;
  if (typeof requestId === "number" && Number.isFinite(requestId)) return String(requestId);
  return undefined;
}
