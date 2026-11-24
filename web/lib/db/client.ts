import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { errorEnvelope } from "../contracts";
import * as schema from "./schema";

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

export type DatabaseConfig = { binding: string };

// The binding lives in the Workers runtime, not in process.env. Keeping the
// lookup lazy lets builds and public routes start without a D1 binding.
export function readDatabaseConfig(env: { DB?: unknown } | NodeJS.ProcessEnv = {}): DatabaseConfig {
  if (!(env as { DB?: unknown }).DB) {
    throw new DatabaseConfigurationError(
      "DATABASE_NOT_CONFIGURED",
      "Application database is not configured.",
      ["DB"],
    );
  }
  return { binding: "DB" };
}

type D1Like = {
  prepare(sql: string): Statement;
  batch(statements: unknown[]): Promise<Array<{ results: unknown[] }>>;
  exec(sql: string): Promise<unknown>;
};

let bindingPromise: Promise<D1Like> | undefined;

export async function resolveD1(): Promise<D1Like> {
  if (!bindingPromise) {
    // Variable specifier: Node tests do not resolve the Workers-only module,
    // while Vite leaves it for workerd to resolve at runtime.
    const moduleName = "cloudflare:workers";
    bindingPromise = import(/* @vite-ignore */ moduleName)
      .then((mod: unknown) => {
        const binding = (mod as { env?: { DB?: D1Like } }).env?.DB;
        readDatabaseConfig({ DB: binding });
        if (!binding || typeof binding.prepare !== "function") {
          throw new DatabaseConfigurationError("DATABASE_CONFIG_INVALID", "The D1 DB binding is invalid.", ["DB"]);
        }
        return binding;
      })
      .catch((error: unknown) => {
        bindingPromise = undefined;
        if (error instanceof DatabaseConfigurationError) throw error;
        throw new DatabaseConfigurationError(
          "DATABASE_NOT_CONFIGURED",
          "Application database is not configured.",
          ["DB"],
        );
      });
  }
  return bindingPromise;
}

type Statement = {
  bind(...params: unknown[]): Statement;
  all(): Promise<{ results: unknown[] }>;
  run(): Promise<unknown>;
  raw(): Promise<unknown[]>;
  first(): Promise<unknown>;
};

// Drizzle calls prepare() synchronously but every D1 query method is async, so
// a thin deferred facade keeps the existing synchronous db factories intact.
const deferredD1 = {
  prepare(sql: string): Statement {
    return {
      bind: (...params: unknown[]) => makeStatement(sql, params),
      all: () => makeStatement(sql, []).all(),
      run: () => makeStatement(sql, []).run(),
      raw: () => makeStatement(sql, []).raw(),
      first: () => makeStatement(sql, []).first(),
    };
  },
  async batch(statements: unknown[]) {
    const binding = await resolveD1();
    return binding.batch(statements);
  },
  async exec(sql: string) {
    const binding = await resolveD1();
    return binding.exec(sql);
  },
};

function makeStatement(sql: string, params: unknown[]): Statement {
  async function invoke<T>(method: "all" | "run" | "raw" | "first"): Promise<T> {
    const binding = await resolveD1();
    const statement = binding.prepare(sql).bind(...params);
    if (method === "all") return statement.all() as Promise<T>;
    if (method === "run") return statement.run() as Promise<T>;
    if (method === "raw") return statement.raw() as Promise<T>;
    return statement.first() as Promise<T>;
  }
  return {
    bind: (...next: unknown[]) => makeStatement(sql, next),
    all: () => invoke<{ results: unknown[] }>("all"),
    run: () => invoke<unknown>("run"),
    raw: () => invoke<unknown[]>("raw"),
    first: () => invoke<unknown>("first"),
  };
}

export const AppDatabase = drizzle(deferredD1 as never, { schema });
export type AppDatabase = typeof AppDatabase;

export function databaseErrorResponse(error: unknown): Response | null {
  let root: unknown = error;
  while (root instanceof Error && "cause" in root && root.cause) root = root.cause;
  if (!(root instanceof DatabaseConfigurationError)) return null;
  const details: Record<string, string> = { service: "database" };
  if (root.missing.length > 0) details.missing = root.missing.join(",");
  return Response.json(errorEnvelope(root.code, root.message, details), { status: 503 });
}

export function getDatabase(): AppDatabase {
  return AppDatabase;
}
