import fs from "node:fs";
import path from "node:path";
import { composeDigests, imageRefs, type ImageRef } from "../../../src/oracles/pin.js";
import { l3Case } from "../support/case.js";

// P4-MCP-SUPP-001. Reads the compose files the harness ships for the five servers, LibreChat and LiteLLM, plus this
// repo's stub compose, and checks every image. No Docker needed, so it runs in the plain gate.
const HARNESS = path.resolve(process.cwd(), "node_modules", "qa-portfolio-harness", "docker");
const FILES = [
  "nextcloud.compose.yml",
  "nextcloud.mcp.compose.yml",
  "outline.compose.yml",
  "penpot.compose.yml",
  "mattermost.compose.yml",
  "twenty.compose.yml",
  "librechat.compose.yml",
  "litellm.compose.yml",
];

// Findings, not passes: each is an image that is not digest-pinned today, with the reason and the standard fix. The test
// fails on any NEW unpinned image, and fails again when one of these becomes pinned (delete it then).
const KNOWN: Record<string, string> = {
  "twentycrm/twenty:${TAG:-v2.44.0}": "Twenty server and worker are pinned by tag only in the harness compose; pin by digest in the harness",
  "axllent/mailpit:v1.22.3": "Twenty's Mailpit is tag-pinned; the Outline and Penpot composes pin the same release by digest",
  "p4-harness/mattermost-mcp:96ecd17": "built locally from the pinned mattermost-plugin-agents commit 96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1; the pin is a git commit, not an image digest",
  "p4-suite-stub:local": "built locally from this repo's Dockerfile, whose base image is pinned by digest",
};

l3Case(
  "P4-MCP-SUPP-001",
  "server images and digests are pinned; an unpinned drift fails",
  async (ctx) => {
    const refs: ImageRef[] = [];
    for (const f of FILES) refs.push(...imageRefs(fs.readFileSync(path.join(HARNESS, f), "utf8"), `harness/docker/${f}`));
    refs.push(...imageRefs(fs.readFileSync(path.resolve(process.cwd(), "docker", "stub.compose.yml"), "utf8"), "docker/stub.compose.yml"));
    ctx.check(composeDigests(refs, KNOWN));
    ctx.note(`findings: ${Object.keys(KNOWN).join(", ")}`);
  },
  { stack: false },
);
