import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scanText } from "./whitespace-check.mjs";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("./whitespace-check.mjs", import.meta.url));

test("scanText detects trailing whitespace and conflict markers", () => {
  assert.deepEqual(scanText("clean line\nsecond line\n"), []);
  assert.deepEqual(scanText("bad line \n"), [
    { file: "<text>", line: 1, rule: "trailing-whitespace" },
  ]);
  assert.deepEqual(scanText("<<<<<<< HEAD\n"), [
    { file: "<text>", line: 1, rule: "conflict-marker" },
  ]);
});

test("tracked-file whitespace gate RED on seeded file, GREEN after cleanup", () => {
  const fixture = join(webDir, ".test-cache", `whitespace-${process.pid}`);
  mkdirSync(fixture, { recursive: true });
  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    writeFileSync(join(fixture, "trailing.txt"), "seeded line \n");
    execFileSync("git", ["add", "trailing.txt"], { cwd: fixture });

    const red = spawnSync(process.execPath, [script, fixture], { encoding: "utf8" });
    assert.equal(red.status, 1, red.stderr);
    assert.match(red.stderr, /trailing\.txt:1: trailing-whitespace/);

    writeFileSync(join(fixture, "trailing.txt"), "clean line\n");
    execFileSync("git", ["add", "trailing.txt"], { cwd: fixture });
    const green = spawnSync(process.execPath, [script, fixture], { encoding: "utf8" });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /0 findings/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("--baseline tolerates listed findings but still fails on new ones", () => {
  const fixture = join(webDir, ".test-cache", `whitespace-baseline-${process.pid}`);
  mkdirSync(fixture, { recursive: true });
  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    writeFileSync(join(fixture, "old.txt"), "known line \n");
    writeFileSync(join(fixture, "new.txt"), "new line \n");
    execFileSync("git", ["add", "."], { cwd: fixture });
    const baseline = join(fixture, "baseline.txt");
    writeFileSync(baseline, "# comment\nold.txt:1:trailing-whitespace\n");

    const tolerated = spawnSync(process.execPath, [script, "--baseline", baseline, fixture], { encoding: "utf8" });
    assert.equal(tolerated.status, 1, tolerated.stderr);
    assert.match(tolerated.stderr, /new\.txt:1: trailing-whitespace/);
    assert.match(tolerated.stderr, /1 baselined/);

    writeFileSync(baseline, "old.txt:1:trailing-whitespace\nnew.txt:1:trailing-whitespace\n");
    const passed = spawnSync(process.execPath, [script, "--baseline", baseline, fixture], { encoding: "utf8" });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /0 new findings \(2 baselined\)/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
