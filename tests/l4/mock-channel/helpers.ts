import type { AddressInfo } from "node:net";
import { createMockChannelServer } from "../../../src/mock-channel/server.js";
import type { InboundSpec, ReactionSpec } from "../../../src/mock-channel/types.js";

export const TEST_TOKEN = "7770001:unit-test-token-not-a-secret-xxxxxxxx";

export interface RunningMock {
  port: number;
  base: string;
  close(): Promise<void>;
  bot(method: string, params?: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  inbound(spec: InboundSpec): Promise<{ updateId: number; messageId: number }>;
  react(spec: ReactionSpec): Promise<{ updateId: number }>;
  control(method: string, path: string, body?: unknown): Promise<Record<string, unknown>>;
}

/** Starts the mock channel on 127.0.0.1 with an ephemeral port. */
export async function startMockChannel(): Promise<RunningMock> {
  const server = createMockChannelServer({ token: TEST_TOKEN, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const control = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    port,
    base,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
    bot: async (method, params = {}, token = TEST_TOKEN) => {
      const res = await fetch(`${base}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    inbound: async (spec) => (await control("POST", "/__mc/inbound", spec)) as { updateId: number; messageId: number },
    react: async (spec) => (await control("POST", "/__mc/reaction", spec)) as { updateId: number },
    control,
  };
}
