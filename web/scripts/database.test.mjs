import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getTableName } from "drizzle-orm";
import { localD1 } from "./sqlite-harness.mjs";

const { readDatabaseConfig, getDatabase, isTransactionControl } = await import("../lib/db/client.ts");
const { profiles } = await import("../lib/db/schema.ts");

const migrationUrl = new URL("../migrations/0000_cloudflare_d1.sql", import.meta.url);

async function freshDatabase() {
  const db = localD1();
  const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
  await db.exec(sql);
  return { db, sql };
}

test("migration is a single numbered D1 baseline", async () => {
  const entries = await readdir(fileURLToPath(new URL("../migrations/", import.meta.url)), { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).map((entry) => entry.name).sort();
  assert.deepEqual(files, ["0000_cloudflare_d1.sql"]);
  const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
  assert.match(sql, /CREATE TABLE `auth_users`/);
  assert.match(sql, /CREATE TABLE `profiles`/);
  assert.doesNotMatch(sql, /CREATE\s+SCHEMA/i);
});

test("D1 facade skips transaction control statements", () => {
  for (const sql of ["begin", "COMMIT;", "rollback", "savepoint sp0", "release savepoint sp0", "rollback to savepoint sp0"]) {
    assert.equal(isTransactionControl(sql), true, sql);
  }
  assert.equal(isTransactionControl("select * from comments"), false);
  assert.equal(isTransactionControl("insert into profiles (user_id) values ('u1')"), false);
});

test("Drizzle journal is the SQLite journal beside the D1 migration", async () => {
  const dir = new URL("../migrations/", import.meta.url);
  const journal = JSON.parse(await readFile(fileURLToPath(new URL("meta/_journal.json", dir)), "utf8"));
  assert.equal(journal.dialect, "sqlite");
  assert.deepEqual(journal.entries.map((entry) => entry.tag), ["0000_cloudflare_d1"]);
  const snapshots = (await readdir(fileURLToPath(new URL("meta/", dir)))).filter((name) => name.endsWith("_snapshot.json"));
  assert.equal(snapshots.length, journal.entries.length);
});

test("migration owns only application and auth user tables", async () => {
  const { db, sql } = await freshDatabase();
  try {
    assert.doesNotMatch(sql, /neon_auth/i, "SQL must not manage a managed-auth schema");
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    assert.deepEqual(
      tables.rows.map((row) => row.name),
      [
        "action_events", "auth_users", "chapter_progress", "comment_reports", "comment_threads",
        "comments", "cultivation_realms", "library_entries", "notification_cursors",
        "notification_pending", "notifications", "profiles", "reader_checkpoints",
        "reader_preferences", "reader_sessions", "reading_completions", "user_roles", "xp_events",
      ],
    );
    const columns = await db.query("PRAGMA table_info(profiles)");
    assert.deepEqual(columns.rows.map((row) => [row.name, row.type.toLowerCase(), row.notnull]), [
      ["user_id", "text", 1], ["username", "text", 0], ["display_name", "text", 0],
      ["avatar_url", "text", 0], ["total_xp", "integer", 1], ["level", "integer", 1],
      ["created_at", "integer", 1], ["updated_at", "integer", 1],
    ]);
  } finally {
    db.close();
  }
});

test("profiles accept opaque user ids and enforce uniqueness inside a transaction", async () => {
  const { db } = await freshDatabase();
  try {
    const opaqueId = "google|not-a-uuid|opaque-123";
    await db.exec(`INSERT INTO profiles (user_id) VALUES ('${opaqueId}');`);
    const found = await db.query("SELECT user_id FROM profiles WHERE user_id = ?", [opaqueId]);
    assert.deepEqual(found.rows, [{ user_id: opaqueId }]);

    await assert.rejects(
      db.exec(`INSERT INTO profiles (user_id) VALUES ('${opaqueId}');`),
      /unique/i,
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO profiles (user_id) VALUES (?)", ["rollback-user"]);
        throw new Error("force rollback");
      }),
      /force rollback/,
    );
    const rolledBack = await db.query("SELECT user_id FROM profiles WHERE user_id = ?", ["rollback-user"]);
    assert.equal(rolledBack.rows.length, 0);
  } finally {
    db.close();
  }
});

test("application tables enforce ownership keys, unique usernames and cascade cleanup", async () => {
  const { db } = await freshDatabase();
  try {
    await db.exec("INSERT INTO profiles (user_id) VALUES ('opaque-1'), ('opaque-2');");
    await db.exec("INSERT INTO user_roles (user_id, role) VALUES ('opaque-1', 'admin');");
    await db.exec("INSERT INTO library_entries (user_id, manga_id, title, followed_at) VALUES ('opaque-1', 'm1', 'One', 100);");
    await db.exec("INSERT INTO reader_preferences (user_id) VALUES ('opaque-1');");
    await db.exec("INSERT INTO chapter_progress (user_id, manga_id, chapter_id, language, page, max_page, total, last_read_at) VALUES ('opaque-1', 'm1', 'c1', 'vi', 3, 3, 10, 100);");
    await db.exec("INSERT INTO comment_threads (target_type, target_id) VALUES ('manga', 'm1');");
    await db.exec("INSERT INTO comments (id, user_id, target_type, target_id, body) VALUES ('c1', 'opaque-1', 'manga', 'm1', 'hello');");
    await db.exec("INSERT INTO comment_reports (id, user_id, comment_id, reason) VALUES ('r1', 'opaque-2', 'c1', 'spam');");
    await db.exec("INSERT INTO notifications (id, user_id, type, event_key, title, body) VALUES ('n1', 'opaque-1', 'level_up', 'level:2', 'Level', 'body');");
    await db.exec("INSERT INTO notification_cursors (user_id, manga_id, language, last_publish) VALUES ('opaque-1', 'm1', 'vi', 100);");
    await db.exec("INSERT INTO notification_pending (user_id, manga_id, language, chapter_id, publish) VALUES ('opaque-1', 'm1', 'vi', 'c1', 100);");
    await db.exec("INSERT INTO action_events (id, user_id, action, occurred_at) VALUES ('e1', 'opaque-1', 'comment', 100);");

    await assert.rejects(
      db.exec("INSERT INTO library_entries (user_id, manga_id, title, followed_at) VALUES ('opaque-1', 'm1', 'Duplicate', 200);"),
      /unique/i,
    );
    await assert.rejects(
      db.exec("INSERT INTO chapter_progress (user_id, manga_id, chapter_id, language, page, max_page, total, last_read_at) VALUES ('opaque-1', 'm1', 'c1', 'vi', 9, 9, 10, 200);"),
      /unique/i,
    );
    await db.exec("UPDATE profiles SET username = 'reader.one' WHERE user_id = 'opaque-1';");
    await assert.rejects(
      db.exec("UPDATE profiles SET username = 'reader.one' WHERE user_id = 'opaque-2';"),
      /unique/i,
    );

    await db.exec("DELETE FROM profiles WHERE user_id = 'opaque-1';");
    for (const table of [
      "user_roles", "library_entries", "reader_preferences", "chapter_progress",
      "comments", "comment_reports", "notification_cursors", "notification_pending", "notifications", "action_events",
      "reader_sessions", "reading_completions", "xp_events",
    ]) {
      const rows = await db.query(`SELECT 1 FROM ${table} WHERE user_id = 'opaque-1'`);
      assert.equal(rows.rows.length, 0, `${table} must cascade with the profile`);
    }
  } finally {
    db.close();
  }
});

test("realm seed and XP ledger uniqueness match the progression contract", async () => {
  const { db } = await freshDatabase();
  try {
    const realms = await db.query("SELECT key, min_level, max_level, name FROM cultivation_realms ORDER BY min_level");
    assert.equal(realms.rows.length, 13);
    assert.deepEqual(realms.rows.map((row) => [row.min_level, row.max_level, row.name]), [
      [1, 9, "Phàm Nhân"], [10, 49, "Luyện Khí"], [50, 99, "Trúc Cơ"],
      [100, 199, "Kim Đan"], [200, 299, "Nguyên Anh"], [300, 399, "Hóa Thần"],
      [400, 499, "Luyện Hư"], [500, 599, "Hợp Thể"], [600, 699, "Đại Thừa"],
      [700, 799, "Độ Kiếp"], [800, 899, "Chân Tiên"], [900, 999, "Tiên Vương"],
      [1000, 1000, "Tiên Đế"],
    ]);
    await db.exec("INSERT INTO profiles (user_id) VALUES ('u1');");
    await db.exec("INSERT INTO reading_completions (user_id, chapter_id, manga_id, language, page_count, last_page_seen, reader_session_id, completed_at) VALUES ('u1','c1','m1','vi',10,10,'s1',100);");
    await assert.rejects(
      db.exec("INSERT INTO reading_completions (user_id, chapter_id, manga_id, language, page_count, last_page_seen, reader_session_id, completed_at) VALUES ('u1','c1','m1','en',10,10,'s2',200);"),
      /unique/i,
    );
    await db.exec("INSERT INTO xp_events (id, user_id, event_type, chapter_id, amount, rule_version) VALUES ('x1','u1','chapter_complete','c1',100,'progression_v1');");
    await assert.rejects(
      db.exec("INSERT INTO xp_events (id, user_id, event_type, chapter_id, amount, rule_version) VALUES ('x2','u1','chapter_complete','c1',100,'progression_v1');"),
      /unique/i,
    );
  } finally {
    db.close();
  }
});

test("database config requires the D1 binding and getDatabase stays lazy", () => {
  assert.equal(getTableName(profiles), "profiles");
  const keys = Object.keys(profiles);
  assert.ok(keys.includes("userId"));
  assert.ok(!keys.some((key) => /auth|session|account/i.test(key)));
  assert.throws(
    () => readDatabaseConfig({}),
    (error) => error.code === "DATABASE_NOT_CONFIGURED" && error.missing.includes("DB"),
  );
  assert.deepEqual(readDatabaseConfig({ DB: {} }), { binding: "DB" });
  assert.equal(getDatabase(), getDatabase());
});
