import { DatabaseSync } from "node:sqlite";

// Local D1-compatible harness: real SQLite via node:sqlite, exposed through the
// small D1 surface Drizzle uses. No Postgres server or external DB dependency.
class LocalStatement {
  constructor(database, owner, sql, params) {
    this.database = database;
    this.owner = owner;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new LocalStatement(this.database, this.owner, this.sql, params);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params).map((row) => ({ ...row })) };
  }

  async run() {
    const keyword = this.sql.trim().toLowerCase();
    if (keyword === "begin") await this.owner.beginTransaction();
    try {
      return this.database.prepare(this.sql).run(...this.params);
    } finally {
      if (keyword === "commit" || keyword === "rollback") this.owner.endTransaction();
    }
  }

  async raw() {
    const statement = this.database.prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.params);
  }

  async first() {
    return (await this.all()).results[0] ?? null;
  }
}

export class LocalD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.transactionTail = Promise.resolve();
    this.releaseTransaction = null;
  }

  // Drizzle opens transactions through SQL, not LocalD1.transaction(), so the
  // lock lives here: concurrent async requests cannot interleave their BEGIN.
  async beginTransaction() {
    const previous = this.transactionTail;
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.transactionTail = previous.then(() => current);
    await previous;
    this.releaseTransaction = release;
  }

  endTransaction() {
    const release = this.releaseTransaction;
    this.releaseTransaction = null;
    release?.();
  }

  prepare(sql) {
    return new LocalStatement(this.database, this, sql, []);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push({ results: (await statement.all()).results, success: true });
    }
    return results;
  }

  async exec(sql) {
    this.database.exec(sql);
  }

  // Convenience query shape used by the SQL-level tests.
  async query(sql, params = []) {
    const sqliteSql = sql.replace(/\$\d+/g, "?").replace(/::[a-z_]+/gi, "");
    return { rows: this.database.prepare(sqliteSql).all(...params).map((row) => ({ ...row })) };
  }

  async transaction(work) {
    this.database.exec("BEGIN");
    try {
      const result = await work(this);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

export function localD1() {
  return new LocalD1();
}
