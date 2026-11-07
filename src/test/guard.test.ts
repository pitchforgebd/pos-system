import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The production guard must stop `npm test` (the tests write and delete rows), but it must not
// stop `npx prisma db seed`, which runs on real servers (https APP_URL) through the same loader.
// Each command is loaded in a fresh process with the --import list that package.json declares.

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: { test: string };
  prisma: { seed: string };
};

function importsOf(command: string) {
  return [...command.matchAll(/--import\s+(\S+)/g)].map((match) => match[1]);
}

function load(command: string, setting: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...process.env, ...setting };
  if (!("NODE_ENV" in setting)) {
    delete env.NODE_ENV;
  }
  const args = [
    "--experimental-strip-types",
    ...importsOf(command).flatMap((file) => ["--import", file]),
    "-e",
    "process.exit(0)",
  ];
  return spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8" });
}

const production = { NODE_ENV: "production", APP_URL: "https://shop.example.com" };
const httpsOnly = { APP_URL: "https://shop.example.com" };
const local = { APP_URL: "http://localhost:3000" };

test("both commands declare the loader that resolves the @/ alias", () => {
  assert.equal(importsOf(pkg.scripts.test).some((file) => file.endsWith("register.mjs")), true);
  assert.equal(importsOf(pkg.prisma.seed).some((file) => file.endsWith("register.mjs")), true);
});

test("the seed command still starts on a production configuration", () => {
  for (const setting of [production, httpsOnly]) {
    const result = load(pkg.prisma.seed, setting);
    assert.equal(result.status, 0, result.stderr.split("\n").find((line) => line.includes("Error")) ?? result.stderr);
  }
});

test("the test command refuses to start on a production configuration", () => {
  for (const setting of [production, httpsOnly]) {
    const result = load(pkg.scripts.test, setting);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to run tests/);
  }
});

test("the test command starts on a local configuration", () => {
  const result = load(pkg.scripts.test, local);
  assert.equal(result.status, 0, result.stderr);
});
