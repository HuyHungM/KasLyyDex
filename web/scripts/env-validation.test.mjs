import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const example = await readFile(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");

const REQUIRED = [
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "DATABASE_URL",
  "READER_TICKET_SECRET",
  "RUST_CONTENT_API_ORIGIN",
  "NEXT_PUBLIC_APP_URL",
];

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
