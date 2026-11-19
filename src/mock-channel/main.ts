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

// Seconds since the epoch: higher than the ids of any earlier run of this container, so OpenClaw's saved poll offset never hides updates.
const server = createMockChannelServer({ token, port, idBase: Math.floor(Date.now() / 1000) });
server.listen(port, host, () => {
  console.log(`mock channel listening on http://${host}:${port}`);
});
