import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

// Prove the shell never needs Neon/auth configuration to answer.
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
  if (/DATABASE|POSTGRES|NEON|AUTH|GOOGLE_CLIENT|RUST_CONTENT_API_ORIGIN/i.test(key)) {
    delete childEnv[key];
  }
}
childEnv.NODE_ENV = "production";

let server;
let baseUrl;
let output = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/favicon.ico`, { signal: AbortSignal.timeout(2_000) });
      await res.arrayBuffer();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`next start did not become ready: ${lastError}\n${output}`);
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: webDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  await waitForServer();
});

after(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
  server.kill("SIGTERM");
  await exited;
  if (server.exitCode === null) server.kill("SIGKILL");
});

test("root serves the branded KasLyyDex shell without Neon/auth credentials", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /KasLyyDex/);
});

test("GET /api/v1/health returns ok and version without secrets", async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);

  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["ok", "version"]);
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, "string");
  assert.ok(body.version.length > 0);
});
