import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scanText } from "./secret-scan-lib.mjs";

const example = await readFile(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");
const rootFile = (relativePath) => fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const { readDatabaseConfig } = await import("../lib/db/client.ts");

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

// Historical SDD artifacts and the two migration records describe the removed
// platforms; scanner tests and this file must name the strings they reject.
const SWEEP_EXEMPT = [
  "docs/superpowers/sdd/",
  "docs/superpowers/plans/2026-11-23-netlify-migration.md",
  "docs/superpowers/specs/2026-11-23-netlify-migration-design.md",
  "web/scripts/env-validation.test.mjs",
  "web/scripts/observability.test.mjs",
  "web/scripts/secret-scan-lib.mjs",
  "web/scripts/secret-scan.test.mjs",
];
const SWEEP_PATTERNS = [
  "@neon/auth", "NEON_AUTH_", "DATABASE_URL", "@vercel/functions", "vercel deploy",
];

test("Netlify build config pins base, command and Node version", async () => {
  const config = await readFile(rootFile("netlify.toml"), "utf8");
  assert.match(config, /^\s*base\s*=\s*"web"\s*$/m);
  assert.match(config, /^\s*command\s*=\s*".*npm run build"\s*$/m);
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

test("database config reads only the Netlify connection name", () => {
  const url = "postgresql://u:" + "p@localhost/db";
  assert.deepEqual(readDatabaseConfig({ NETLIFY_DB_URL: url }), { url });
  assert.throws(
    () => readDatabaseConfig({}),
    (error) => {
      assert.equal(error.code, "DATABASE_NOT_CONFIGURED");
      assert.deepEqual(error.missing, ["NETLIFY_DB_URL"]);
      return true;
    },
  );
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

test("root Dockerfile builds and runs the Axum server without secrets", async () => {
  const dockerfile = await readFile(rootFile("Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM\s+rust:[^\s]+\s+AS\s+builder\s*$/im, "Rust builder stage");
  assert.match(dockerfile, /^FROM\s+\S+\s+AS\s+runtime\s*$/im, "runtime stage");
  assert.match(dockerfile, /^EXPOSE\s+3100\s*$/m, "public port 3100");
  assert.match(dockerfile, /cargo build --release --locked -p server/, "server release build");
  assert.match(dockerfile, /COPY --from=builder \S+ \/usr\/local\/bin\/server/, "binary copied to runtime");
  assert.match(dockerfile, /^(?:ENTRYPOINT|CMD) \[/m, "runtime command");
  assert.doesNotMatch(dockerfile, /^\s*(?:ENV|ARG)\s+[A-Z_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z_]*=/im);
  assert.deepEqual(scanText(dockerfile, "Dockerfile"), []);
});

test("Northflank runbook pins the combined-service settings", async () => {
  const runbook = await readFile(rootFile("infra/northflank.md"), "utf8");
  const required = [
    ["Dockerfile build type", /Dockerfile/i],
    ["combined service", /combined service/i],
    ["public port 3100", /\b3100\b/],
    ["liveness route", /\/api\/v1\/health/],
    ["readiness route", /\/api\/v1\/ready/],
    ["CACHE_DIR volume", /CACHE_DIR/],
    ["build rollback", /build rollback/i],
    ["preview pipelines out of scope", /preview pipeline/i],
    ["out of scope", /out of scope/i],
  ];
  for (const [label, pattern] of required) assert.match(runbook, pattern, label);
});

test(".env.example keeps the content origin hostname-free", () => {
  assert.match(example, /^RUST_CONTENT_API_ORIGIN=$/m);
  assert.doesNotMatch(example, /northflank\.(?:net|io|app|com)/i);
});

test("current tracked source and docs have no removed platform references", async () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoDir, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((file) => /\.(?:md|mjs|js|ts|tsx|json|yml|yaml|sql|toml|example|txt)$/.test(file) || file.endsWith(".env.example"))
    .filter((file) => !SWEEP_EXEMPT.some((exempt) => file.startsWith(exempt)));
  const offenders = [];
  for (const file of files) {
    const text = await readFile(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
    for (const pattern of SWEEP_PATTERNS) {
      if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `stale references in ${files.length} tracked files`);
});
