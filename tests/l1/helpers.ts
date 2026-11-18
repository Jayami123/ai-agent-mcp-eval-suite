import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createStubServer } from "../../src/stub/server.js";

export const FIXTURES_DIR = path.resolve(process.cwd(), "src/stub/fixtures");

export interface RunningStub {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/** Starts the stub on 127.0.0.1 with an ephemeral port. */
export async function startStub(): Promise<RunningStub> {
  const server = createStubServer({ fixturesDir: FIXTURES_DIR, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface RawResponse {
  status: number;
  raw: string;
}

/** POST a chat request. Fixture is selected by header when `fixtureHeader` is given. */
export async function postChat(
  port: number,
  body: unknown,
  fixtureHeader?: string,
): Promise<RawResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (fixtureHeader !== undefined) headers["x-p4-fixture"] = fixtureHeader;
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, raw: await res.text() };
}
