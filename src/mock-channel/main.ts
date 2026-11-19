import { createMockChannelServer } from "./server.js";

const rawPort = process.env["MOCK_CHANNEL_PORT"] ?? "8788";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`MOCK_CHANNEL_PORT is not a valid port: ${rawPort}`);
}
// 127.0.0.1 unless the mock runs in a container, where 0.0.0.0 lets the published port reach it. The compose file publishes
// that port on 127.0.0.1 only.
const host = process.env["MOCK_CHANNEL_HOST"] ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") {
  throw new Error("MOCK_CHANNEL_HOST must be 127.0.0.1 or 0.0.0.0");
}
const token = process.env["MOCK_CHANNEL_TOKEN"];
if (token === undefined || token === "") {
  console.error("MOCK_CHANNEL_TOKEN is required (the value is never printed).");
  process.exit(1);
}

const server = createMockChannelServer({ token, port });
server.listen(port, host, () => {
  console.log(`mock channel listening on http://${host}:${port}`);
});
