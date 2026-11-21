import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { repoDir, startHttpServer, webDir } from "./test-helpers.mjs";

const generatedDir = join(webDir, "generated", "reader-wasm");
const publicWasmDir = join(webDir, "public", "wasm");
let server;
let ReaderWasm;
let init;

before(async () => {
  assert.ok(
    existsSync(join(repoDir, "crates", "reader-wasm", "src", "lib.rs")),
    "reader-wasm crate must exist",
  );
  assert.ok(existsSync(join(generatedDir, "index.ts")), "run npm run build:wasm first");
  const entry = readFileSync(join(generatedDir, "index.ts"), "utf8");
  const asset = entry.match(/WASM_URL\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(asset, "generated entry must expose a hashed WASM_URL");
  assert.match(asset, /\/wasm\/reader_core\.[a-f0-9]+\.wasm$/);
  assert.ok(existsSync(join(webDir, "public", asset)), "hashed wasm asset must exist");

  const declarations = readFileSync(join(generatedDir, "reader_core.d.ts"), "utf8");
  for (const method of [
    "pageIndex", "totalPages", "setPage", "nextPage", "previousPage",
    "canNext", "canPrevious", "progressPercent", "settingsJson", "setMode",
  ]) {
    assert.match(declarations, new RegExp(method), `missing exported method ${method}`);
  }

  server = await startHttpServer((req, res) => {
    if (req.url?.endsWith(".wasm")) {
      res.writeHead(200, { "content-type": "application/wasm" });
      res.end(readFileSync(join(webDir, "public", asset)));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const module = await import(new URL("../generated/reader-wasm/index.mjs", import.meta.url).href);
  init = module.init;
  ReaderWasm = module.ReaderWasm;
  await init({ module_or_path: `${server.baseUrl}${asset}` });
});

after(async () => {
  await server?.close();
});

test("generated build writes only one hashed wasm asset", () => {
  const files = readdirSync(publicWasmDir).filter((name) => name.endsWith(".wasm"));
  assert.equal(files.length, 1, files.join(", "));
});

test("actual wasm state enforces page boundaries and progress", () => {
  const reader = new ReaderWasm(4);
  assert.equal(reader.totalPages(), 4);
  assert.equal(reader.pageIndex(), 0);
  assert.equal(reader.progressPercent(), 25);
  assert.equal(reader.canPrevious(), false);
  assert.equal(reader.previousPage(), false);
  assert.equal(reader.nextPage(), true);
  assert.equal(reader.pageIndex(), 1);
  reader.setPage(3);
  assert.equal(reader.progressPercent(), 100);
  assert.equal(reader.nextPage(), false);
  assert.throws(() => reader.setPage(4), /page index 4/);
  assert.equal(reader.pageIndex(), 3);
  assert.throws(() => new ReaderWasm(0), /total_pages must be greater than zero/);
});

test("actual wasm settings methods mutate shared rust state", () => {
  const reader = new ReaderWasm(2);
  reader.setMode("horizontal");
  assert.match(reader.settingsJson(), /"mode":"horizontal"/);
  reader.setMode("vertical");
  assert.match(reader.settingsJson(), /"mode":"vertical"/);
  assert.throws(() => reader.setMode("diagonal"), /invalid/);
});
