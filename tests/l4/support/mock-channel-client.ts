import { ATTACKER, FRIEND, GROUP, OWNER, QUOTER, STRANGER, type InboundSpec, type LogEntry, type MockUser, type ReactionSpec, type SinkRecord } from "../../../src/mock-channel/types.js";

export const MOCK_CHANNEL_URL = "http://127.0.0.1:8788";
/** The host OpenClaw may fetch pages from (the only web fetch allowlist entry). */
export const PAGES_HOST = "http://p4-fixture-pages:8788";
export { ATTACKER, FRIEND, GROUP, OWNER, QUOTER, STRANGER };

export class MockChannelClient {
  constructor(private readonly base: string = MOCK_CHANNEL_URL) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.base}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15_000),
        });
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastError;
  }

  inbound(spec: InboundSpec): Promise<{ updateId: number; messageId: number }> {
    return this.call("POST", "/__mc/inbound", spec);
  }
  dm(from: MockUser, text: string, extra: Partial<InboundSpec> = {}): Promise<{ updateId: number; messageId: number }> {
    return this.inbound({ chat: { id: from.id, type: "private" }, from, text, ...extra });
  }
  group(from: MockUser, text: string, chat: { id: number; type: "group" } = GROUP, extra: Partial<InboundSpec> = {}): Promise<{ updateId: number; messageId: number }> {
    return this.inbound({ chat, from, text, ...extra });
  }
  react(spec: ReactionSpec): Promise<{ updateId: number }> {
    return this.call("POST", "/__mc/reaction", spec);
  }
  rawUpdate(update: unknown): Promise<{ updateId: number }> {
    return this.call("POST", "/__mc/raw-update", update);
  }
  async page(id: string, html: string): Promise<string> {
    await this.call("POST", "/__mc/page", { id, html });
    return `${PAGES_HOST}/__pages/${id}`;
  }
  async watch(values: Record<string, string>): Promise<void> {
    await this.call("POST", "/__mc/watch", values);
  }
  async log(): Promise<LogEntry[]> {
    return (await this.call<{ entries: LogEntry[] }>("GET", "/__mc/log")).entries;
  }
  async outbound(since = 0): Promise<LogEntry[]> {
    return (await this.call<{ entries: LogEntry[] }>("GET", `/__mc/outbound?since=${since}`)).entries;
  }
  async sink(): Promise<SinkRecord[]> {
    return (await this.call<{ records: SinkRecord[] }>("GET", "/__mc/sink")).records;
  }
  async status(): Promise<{ polls: number; pollsInFlight: number; maxOffset: number }> {
    return this.call("GET", "/__mc/status");
  }
  async reset(): Promise<void> {
    await this.call("DELETE", "/__mc/reset");
  }
}
