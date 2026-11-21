import "server-only";

import { Pool } from "pg";
import { AuthConfigurationError, readAuthConfig } from "./auth/server";
import { DatabaseConfigurationError, readDatabaseConfig } from "./db/client";

export type ReadinessCheck = "ok" | "missing" | "invalid" | "unavailable" | "skipped";

export type ReadinessReport = {
  status: "ready" | "unavailable";
  checks: { configuration: ReadinessCheck; database: ReadinessCheck; upstream: ReadinessCheck };
  // Env names only. Values, URLs and upstream messages never enter this report.
  missing: string[];
};

const CHECK_TIMEOUT_MS = 1_500;

function invalidContentOrigin(env: NodeJS.ProcessEnv): boolean {
  const raw = env.RUST_CONTENT_API_ORIGIN?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return !["http:", "https:"].includes(url.protocol) || Boolean(url.username || url.password);
  } catch {
    return true;
  }
}

async function databaseReachable(url: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    query_timeout: CHECK_TIMEOUT_MS,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function upstreamReachable(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/v1/ready`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/// Readiness is deliberately separate from the credential-free liveness route.
/// It validates configuration without printing values, then performs bounded
/// DB and content-upstream probes. Missing local config is a normal 503.
export async function checkReadiness(env: NodeJS.ProcessEnv = process.env): Promise<ReadinessReport> {
  const missing: string[] = [];
  let databaseUrl = "";
  let contentOrigin = "";

  try {
    databaseUrl = readDatabaseConfig(env).url;
  } catch (error) {
    if (error instanceof DatabaseConfigurationError && error.missing.length > 0) {
      missing.push(...error.missing);
    } else {
      missing.push("DATABASE_URL");
    }
  }
  try {
    readAuthConfig(env);
  } catch (error) {
    if (error instanceof AuthConfigurationError && error.missing.length > 0) {
      missing.push(...error.missing);
    } else {
      missing.push("NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET");
    }
  }
  const ticket = env.READER_TICKET_SECRET?.trim();
  if (!ticket || ticket.length < 32) missing.push("READER_TICKET_SECRET");
  const origin = env.RUST_CONTENT_API_ORIGIN?.trim();
  if (!origin) missing.push("RUST_CONTENT_API_ORIGIN");
  else if (invalidContentOrigin(env)) missing.push("RUST_CONTENT_API_ORIGIN");
  else contentOrigin = new URL(origin).origin;

  const checks: ReadinessReport["checks"] = {
    configuration: missing.length === 0 ? "ok" : "missing",
    database: "skipped",
    upstream: "skipped",
  };
  if (databaseUrl) checks.database = (await databaseReachable(databaseUrl)) ? "ok" : "unavailable";
  if (contentOrigin) checks.upstream = (await upstreamReachable(contentOrigin)) ? "ok" : "unavailable";

  return {
    status: missing.length === 0 && checks.database === "ok" && checks.upstream === "ok"
      ? "ready"
      : "unavailable",
    checks,
    missing: [...new Set(missing)].sort(),
  };
}

export function readinessResponse(report: ReadinessReport): Response {
  return Response.json(
    { status: report.status, checks: report.checks, missing: report.missing },
    {
      status: report.status === "ready" ? 200 : 503,
      headers: { "cache-control": "private, no-store" },
    },
  );
}
