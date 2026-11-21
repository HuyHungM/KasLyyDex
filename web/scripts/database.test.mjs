import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableName } from "drizzle-orm";

const { readDatabaseConfig } = await import("../lib/db/client.ts");
const { profiles } = await import("../lib/db/schema.ts");

const migrationUrls = [
  new URL("../drizzle/0000_application.sql", import.meta.url),
  new URL("../drizzle/0001_account_data.sql", import.meta.url),
];

async function freshDatabase() {
  const db = new PGlite();
  let sql = "";
  for (const url of migrationUrls) {
    const next = await readFile(fileURLToPath(url), "utf8");
    sql += `${next}\n`;
    await db.exec(next);
  }
  return { db, sql };
}

test("application migrations own account tables and never touch Neon Auth tables", async () => {
  const { db, sql } = await freshDatabase();
  try {
    assert.doesNotMatch(sql, /neon_auth/i, "Drizzle SQL must not manage Neon-owned identity tables");
    assert.doesNotMatch(sql, /CREATE\s+SCHEMA/i);

    const tables = await db.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => `${row.table_schema}.${row.table_name}`),
      [
        "public.chapter_progress",
        "public.library_entries",
        "public.profiles",
        "public.reader_preferences",
        "public.user_roles",
      ],
      "only application-owned account tables may be created",
    );

    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(columns.rows, [
      { column_name: "user_id", data_type: "text", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "username", data_type: "text", is_nullable: "YES" },
      { column_name: "display_name", data_type: "text", is_nullable: "YES" },
      { column_name: "avatar_url", data_type: "text", is_nullable: "YES" },
      { column_name: "total_xp", data_type: "integer", is_nullable: "NO" },
    ]);

    const pk = await db.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public.profiles'::regclass AND i.indisprimary
    `);
    assert.deepEqual(pk.rows.map((row) => row.attname), ["user_id"]);

    const authSchemas = await db.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'neon_auth'
    `);
    assert.equal(authSchemas.rows.length, 0, "Neon Auth owns its own schema, not this migration");
  } finally {
    await db.close();
  }
});

test("profiles accept opaque user ids and enforce uniqueness inside a transaction", async () => {
  const { db } = await freshDatabase();
  try {
    const opaqueId = "google|not-a-uuid|opaque-123";
    await db.exec(`
      INSERT INTO profiles (user_id) VALUES ('${opaqueId}');
    `);
    const found = await db.query("SELECT user_id FROM profiles WHERE user_id = $1", [opaqueId]);
    assert.deepEqual(found.rows, [{ user_id: opaqueId }]);

    await assert.rejects(
      db.exec(`INSERT INTO profiles (user_id) VALUES ('${opaqueId}');`),
      /duplicate key|unique/i,
    );

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO profiles (user_id) VALUES ($1)", ["rollback-user"]);
        throw new Error("force rollback");
      }),
      /force rollback/,
    );
    const rolledBack = await db.query("SELECT user_id FROM profiles WHERE user_id = $1", ["rollback-user"]);
    assert.equal(rolledBack.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("account tables enforce ownership keys, unique usernames and cascade cleanup", async () => {
  const { db } = await freshDatabase();
  try {
    await db.exec("INSERT INTO profiles (user_id) VALUES ('opaque-1'), ('opaque-2');");
    await db.exec("INSERT INTO user_roles (user_id, role) VALUES ('opaque-1', 'admin');");
    await db.exec("INSERT INTO library_entries (user_id, manga_id, title, followed_at) VALUES ('opaque-1', 'm1', 'One', 100);");
    await db.exec("INSERT INTO reader_preferences (user_id) VALUES ('opaque-1');");
    await db.exec("INSERT INTO chapter_progress (user_id, manga_id, chapter_id, language, page, max_page, total, last_read_at) VALUES ('opaque-1', 'm1', 'c1', 'vi', 3, 3, 10, 100);");

    await assert.rejects(
      db.exec("INSERT INTO library_entries (user_id, manga_id, title, followed_at) VALUES ('opaque-1', 'm1', 'Duplicate', 200);"),
      /duplicate key|unique/i,
    );
    await assert.rejects(
      db.exec("INSERT INTO chapter_progress (user_id, manga_id, chapter_id, language, page, max_page, total, last_read_at) VALUES ('opaque-1', 'm1', 'c1', 'vi', 9, 9, 10, 200);"),
      /duplicate key|unique/i,
    );
    await db.exec("UPDATE profiles SET username = 'reader.one' WHERE user_id = 'opaque-1';");
    await assert.rejects(
      db.exec("UPDATE profiles SET username = 'reader.one' WHERE user_id = 'opaque-2';"),
      /duplicate key|unique/i,
    );

    await db.exec("DELETE FROM profiles WHERE user_id = 'opaque-1';");
    for (const table of ["user_roles", "library_entries", "reader_preferences", "chapter_progress"]) {
      const rows = await db.query(`SELECT 1 FROM ${table} WHERE user_id = 'opaque-1'`);
      assert.equal(rows.rows.length, 0, `${table} must cascade with the profile`);
    }
  } finally {
    await db.close();
  }
});

test("Drizzle schema and database config stay application-only and lazy", () => {
  assert.equal(getTableName(profiles), "profiles");
  const keys = Object.keys(profiles);
  assert.ok(keys.includes("userId"));
  assert.ok(!keys.some((key) => /auth|session|account/i.test(key)));
  assert.throws(
    () => readDatabaseConfig({}),
    (error) => error.code === "DATABASE_NOT_CONFIGURED" && error.missing.includes("DATABASE_URL"),
  );
});
