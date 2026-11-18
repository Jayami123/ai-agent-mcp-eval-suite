import path from "node:path";
import { createStubServer } from "./server.js";

const rawPort = process.env["STUB_PORT"] ?? "4010";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`STUB_PORT is not a valid port: ${rawPort}`);
}
// Run from the repo root (npm scripts do). Fixtures are JSON and are not copied to dist/.
const fixturesDir = process.env["STUB_FIXTURES_DIR"] ?? path.resolve(process.cwd(), "src/stub/fixtures");

const server = createStubServer({ fixturesDir, port });
server.listen(port, "127.0.0.1", () => {
  console.log(`stub listening on http://127.0.0.1:${port}`);
});
