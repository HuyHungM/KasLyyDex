import "server-only";

import { DatabaseConfigurationError, readDatabaseConfig, resolveD1 } from "./db/client";

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

async function databaseReachable(): Promise<boolean> {
  try {
    const binding = await resolveD1();
    await binding.prepare("SELECT 1").first();
    return true;
  } catch {
    return false;
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
  let hasDatabase = false;
  let contentOrigin = "";

  // Workers expose D1 as a binding, not on process.env. Prefer the live
  // binding and fall back to env config for local/test harnesses.
  const binding = await resolveD1().catch(() => null);
  if (binding) {
    hasDatabase = true;
  } else {
    try {
      hasDatabase = Boolean(readDatabaseConfig(env).binding);
    } catch (error) {
      if (error instanceof DatabaseConfigurationError && error.missing.length > 0) {
        missing.push(...error.missing);
      } else {
        missing.push("DB");
      }
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
  if (hasDatabase) checks.database = (await databaseReachable()) ? "ok" : "unavailable";
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
