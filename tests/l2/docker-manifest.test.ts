import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// The lab image has its own manifest so it does not install the harness. This keeps it from drifting from the root.
const read = (file: string): any => JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8"));
const root = read("package.json");
const rootLock = read("package-lock.json");
const image = read("docker/attack-lab/package.json");
const imageLock = read("docker/attack-lab/package-lock.json");

test("the image manifest pins the SDK and zod at exactly the root versions", () => {
  assert.equal(image.dependencies["@modelcontextprotocol/sdk"], root.dependencies["@modelcontextprotocol/sdk"]);
  assert.equal(image.dependencies["zod"], root.dependencies["zod"]);
  assert.match(image.dependencies["zod"], /^\d+\.\d+\.\d+$/, "exact version, no range");
});

test("the image manifest pins TypeScript and @types/node at the versions the root lockfile resolves", () => {
  assert.equal(image.devDependencies["typescript"], rootLock.packages["node_modules/typescript"].version);
  assert.equal(image.devDependencies["@types/node"], rootLock.packages["node_modules/@types/node"].version);
});

test("the image manifest and its lockfile have no harness", () => {
  const names = [...Object.keys(image.dependencies), ...Object.keys(image.devDependencies)];
  assert.equal(names.some((name) => name.includes("qa-portfolio-harness")), false);
  const locked = Object.keys(imageLock.packages);
  assert.equal(locked.some((name) => name.includes("qa-portfolio-harness")), false);
});

test("the image lockfile resolves the same SDK and zod versions", () => {
  assert.equal(imageLock.packages["node_modules/@modelcontextprotocol/sdk"].version, root.dependencies["@modelcontextprotocol/sdk"]);
  assert.equal(imageLock.packages["node_modules/zod"].version, root.dependencies["zod"]);
});

test("the Dockerfile is multi-stage, digest-pinned and takes the token only at run time", () => {
  const dockerfile = readFileSync(path.resolve(process.cwd(), "docker/attack-lab/Dockerfile"), "utf8");
  const froms = dockerfile.split("\n").filter((line) => line.startsWith("FROM "));
  assert.equal(froms.length, 3);
  for (const line of froms) assert.match(line, /@sha256:[0-9a-f]{64}/);
  assert.equal(/^ARG\b/m.test(dockerfile), false, "no build args");
  assert.equal(/LAB_CONTROL_TOKEN/.test(dockerfile.replace(/^#.*$/gm, "")), false, "the token is not baked into the image");
  assert.equal(/qa-portfolio-harness/.test(dockerfile.replace(/^#.*$/gm, "")), false);
});
