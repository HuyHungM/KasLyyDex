import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

export const webDir = fileURLToPath(new URL("..", import.meta.url));
export const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export function envWithoutExternalConfig(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/DATABASE|POSTGRES|NEON|AUTH|GOOGLE_CLIENT|RUST_CONTENT_API_ORIGIN|MANGADEX_API_ORIGIN/i.test(key)) {
      delete env[key];
    }
  }
  return { ...env, NODE_ENV: "production", ...overrides };
}

async function waitForTcp(port, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/favicon.ico`, {
        signal: AbortSignal.timeout(2_000),
      });
      await res.arrayBuffer();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`server on ${port} did not become ready: ${lastError}`);
}

export async function startNext(overrides = {}) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: webDir, env: envWithoutExternalConfig(overrides), stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitForTcp(port);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${error.message}\n${output}`);
  }
  return { child, baseUrl, output: () => output };
}

export async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
  child.kill("SIGTERM");
  await exited;
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function startHttpServer(handler) {
  const port = await freePort();
  const requests = [];
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: req.url, body, headers: req.headers });
      Promise.resolve(handler(req, res, body)).catch((error) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
