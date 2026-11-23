import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// Bounded label vocabulary. Never derive these from request paths, users or
// upstream error strings: metric labels must stay low-cardinality and PII-free.
export const OBSERVED_OPERATIONS = ["auth", "account", "community", "progression"] as const;
export type ObservedOperation = (typeof OBSERVED_OPERATIONS)[number];

const correlation = new AsyncLocalStorage<string>();

// Longer names first so `set-cookie` wins over `cookie` and forwarded headers
// win over plain `authorization`. Headers may use `:`/`=` or whitespace before
// an auth scheme / cookie pair; generic fields need a real `:`/`=` separator so
// ordinary prose such as "This ticket belongs to another account" survives.
const HEADER_FIELDS = [
  "x-forwarded-authorization",
  "proxy-authorization",
  "authorization",
  "set-cookie",
  "cookie",
];
const GENERIC_FIELDS = [
  "connection-string",
  "connection_string",
  "database-url",
  "database_url",
  "upstream-key",
  "upstream_key",
  "api-key",
  "api_key",
  "password",
  "passwd",
  "pwd",
  "secret",
  "ticket",
  "token",
  "email",
  "code",
];
const FIELD_PATTERN = [...HEADER_FIELDS, ...GENERIC_FIELDS].join("|");
const HEADER_SEPARATOR = String.raw`(?:\s*[:=]\s*|\s+(?:(?=(?:Bearer|Basic)\b)|(?=[A-Za-z0-9_.%-]+=)))`;
const GENERIC_SEPARATOR = String.raw`\s*[:=]\s*`;
// Stop at a closing quote, line end, or the next known credential field. For
// Cookie/Set-Cookie this redacts the whole header (every k=v pair), not just
// the first value. `&` handles URL query strings such as ?code=...&token=...
const VALUE_BOUNDARY = String.raw`(?=\s*(?:"|'|$|[\r\n]|[,;|&]\s*(?:${FIELD_PATTERN})(?:${HEADER_SEPARATOR}|${GENERIC_SEPARATOR})|\s+(?:${FIELD_PATTERN})(?:${HEADER_SEPARATOR}|${GENERIC_SEPARATOR})))`;
const VALUE_PATTERN = String.raw`(?:"[^"]*"|'[^']*'|[^\r\n"']*?)`;
const HEADER_PATTERN = new RegExp(
  String.raw`\b(${HEADER_FIELDS.join("|")})${HEADER_SEPARATOR}${VALUE_PATTERN}${VALUE_BOUNDARY}`,
  "gi",
);
const GENERIC_PATTERN = new RegExp(
  String.raw`\b(${GENERIC_FIELDS.join("|")})${GENERIC_SEPARATOR}${VALUE_PATTERN}${VALUE_BOUNDARY}`,
  "gi",
);

function redactValue(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted-database-url]")
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .replace(HEADER_PATTERN, "$1=[redacted]")
    .replace(GENERIC_PATTERN, "$1=[redacted]");
}

/// Shared redaction for structured logs. It never echoes raw headers, bodies,
/// connection strings or credential-bearing query values.
export function redactSecrets(value: unknown): string {
  return redactValue(String(value ?? "")).slice(0, 2000);
}

type LogFields = Record<string, string | number | boolean | undefined>;

export function logStructured(
  level: "info" | "warn" | "error",
  event: string,
  fields: LogFields = {},
): void {
  const entry = JSON.stringify({
    service: "kaslyydex-web",
    ts: new Date().toISOString(),
    level,
    event,
    correlationId: correlation.getStore() ?? "none",
    ...fields,
  });
  // Defense in depth: even a future field that accidentally contains a header
  // or body is redacted before it reaches the log sink.
  const line = redactValue(entry);
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

/// Call from existing error-to-response helpers so error details are logged once
/// in redacted form without adding them to the public error envelope.
export function logErrorEvent(error: unknown): void {
  const value = error as { name?: string; code?: string; message?: string };
  logStructured("error", "error", {
    errorName: typeof value?.name === "string" ? value.name.slice(0, 64) : "Error",
    errorCode: typeof value?.code === "string" ? value.code.slice(0, 64) : undefined,
    message: redactSecrets(value?.message ?? error),
  });
}

export function outcomeFor(status: number): string {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (status >= 200 && status < 300) return "success";
  return "other";
}

function emitMetrics(operation: ObservedOperation, outcome: string, durationMs: number): void {
  // Platform-neutral: request metrics stay in the structured request logs above.
  // Keep the call sites unchanged on every runtime.
  void operation;
  void outcome;
  void durationMs;
}

/// Structured request/error logs and bounded business-operation metrics. Health,
/// static assets and pass-through content proxies deliberately do not use this.
export async function withObservedRoute(
  operation: ObservedOperation,
  request: Request,
  run: () => Promise<Response> | Response,
): Promise<Response> {
  const id = randomUUID();
  const startedAt = performance.now();

  return correlation.run(id, async () => {
    let response: Response;
    try {
      response = await run();
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      logErrorEvent(error);
      logStructured("error", "request.complete", { operation, status: 500, durationMs });
      emitMetrics(operation, "server_error", durationMs);
      throw error;
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const outcome = outcomeFor(response.status);
    logStructured(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
      "request.complete", {
        operation,
        method: request.method,
        status: response.status,
        durationMs,
        outcome,
      });
    emitMetrics(operation, outcome, durationMs);

    const headers = new Headers(response.headers);
    headers.set("x-correlation-id", id);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
