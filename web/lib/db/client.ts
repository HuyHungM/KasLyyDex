import "server-only";

import { getConnectionString } from "@netlify/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { errorEnvelope } from "../contracts";
import * as schema from "./schema";

export type DatabaseConfig = { url: string };

export class DatabaseConfigurationError extends Error {
  readonly code: "DATABASE_NOT_CONFIGURED" | "DATABASE_CONFIG_INVALID";
  readonly missing: string[];

  constructor(
    code: "DATABASE_NOT_CONFIGURED" | "DATABASE_CONFIG_INVALID",
    message: string,
    missing: string[] = [],
  ) {
    super(message);
    this.name = "DatabaseConfigurationError";
    this.code = code;
    this.missing = missing;
  }
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = env.NETLIFY_DB_URL?.trim();
  if (!url) {
    throw new DatabaseConfigurationError(
      "DATABASE_NOT_CONFIGURED",
      "Application database is not configured.",
      ["NETLIFY_DB_URL"],
    );
  }
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new DatabaseConfigurationError("DATABASE_CONFIG_INVALID", "NETLIFY_DB_URL is invalid.");
  }
  return { url };
}

export function databaseErrorResponse(error: unknown): Response | null {
  if (!(error instanceof DatabaseConfigurationError)) return null;
  const details: Record<string, string> = { service: "database" };
  if (error.missing.length > 0) details.missing = error.missing.join(",");
  return Response.json(errorEnvelope(error.code, error.message, details), { status: 503 });
}

function connect(url: string) {
  const pool = new Pool({ connectionString: url, max: 5 });
  return { pool, db: drizzle({ client: pool, schema }) };
}

export type AppDatabase = ReturnType<typeof connect>["db"];

let connection: ReturnType<typeof connect> | undefined;

// Pool creation stays lazy so builds and public routes need no NETLIFY_DB_URL.
export function getDatabase() {
  if (!connection) {
    let url: string;
    try {
      url = readDatabaseConfig().url;
    } catch (error) {
      const absent = error instanceof DatabaseConfigurationError
        && error.code === "DATABASE_NOT_CONFIGURED";
      if (!absent || process.env.NETLIFY !== "true") throw error;
      url = getConnectionString();
    }
    connection = connect(url);
  }
  return connection.db;
}
