import path from "node:path";
import { createStubServer } from "./server.js";

const rawPort = process.env["STUB_PORT"] ?? "4010";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`STUB_PORT is not a valid port: ${rawPort}`);
}
// Run from the repo root (npm scripts do). Fixtures are JSON and are not copied to dist/.
const fixturesDir = process.env["STUB_FIXTURES_DIR"] ?? path.resolve(process.cwd(), "src/stub/fixtures");

// 127.0.0.1 unless the stub runs in a container, where STUB_HOST=0.0.0.0 lets the published port reach it. The compose
// file publishes that port on 127.0.0.1 only.
const host = process.env["STUB_HOST"] ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") {
  throw new Error("STUB_HOST must be 127.0.0.1 or 0.0.0.0");
}

const server = createStubServer({ fixturesDir, port });
server.listen(port, host, () => {
  console.log(`stub listening on http://${host}:${port}`);
});
