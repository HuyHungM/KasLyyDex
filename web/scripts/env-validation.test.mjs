import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const example = await readFile(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");
const rootFile = (relativePath) => fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

const REQUIRED = [
  "NETLIFY_DB_URL",
  "RUST_CONTENT_API_ORIGIN",
  "READER_TICKET_SECRET",
];

const FORBIDDEN = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
];

test("Netlify build config pins base, command and Node version", async () => {
  const config = await readFile(rootFile("netlify.toml"), "utf8");
  assert.match(config, /^\s*base\s*=\s*"web"\s*$/m);
  assert.match(config, /^\s*command\s*=\s*"npm run build"\s*$/m);
  assert.match(config, /^\s*NODE_VERSION\s*=\s*"22"\s*$/m);
});

test(".env.example no longer documents removed platform names", () => {
  for (const name of FORBIDDEN) {
    assert.doesNotMatch(example, new RegExp(`^${name}=`, "m"), name);
  }
});

test("Netlify runbook replaces the old platform runbook", async () => {
  assert.ok((await readFile(rootFile("infra/netlify.md"), "utf8")).length > 0);
  await assert.rejects(access(rootFile("infra/vercel.md")));
});

test(".env.example documents every required runtime name without values", () => {
  for (const name of REQUIRED) {
    assert.match(example, new RegExp(`^${name}=$`, "m"), name);
  }
  assert.doesNotMatch(example, /NEXT_PUBLIC_(?:DATABASE|NEON|GOOGLE_CLIENT_SECRET|READER_TICKET)/);
});

test("configured values are shape-checked without being printed", () => {
  const invalidDatabase = (value) => {
    try {
      const parsed = new URL(value);
      return !["postgres:", "postgresql:"].includes(parsed.protocol);
    } catch {
      return true;
    }
  };
  assert.equal(invalidDatabase("postgresql://reader@db.example.com/kaslyydex"), false);
  assert.equal(invalidDatabase("https://db.example.com"), true);
  assert.equal((process.env.READER_TICKET_SECRET ?? "").length >= 32 || !process.env.READER_TICKET_SECRET, true);
});
