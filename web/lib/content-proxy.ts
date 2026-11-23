import "server-only";
import { errorEnvelope, serviceUnavailableResponse } from "@/lib/contracts";

const RESPONSE_HEADERS = ["content-type", "cache-control", "etag", "last-modified"];
const REQUEST_HEADERS = ["accept", "accept-language", "if-none-match", "if-modified-since"];

export function contentOrigin(): string | Response {
  const raw = process.env.RUST_CONTENT_API_ORIGIN?.trim();
  if (!raw) return serviceUnavailableResponse("content", ["RUST_CONTENT_API_ORIGIN"]);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("invalid origin");
    }
    return url.origin;
  } catch {
    return Response.json(
      errorEnvelope("CONTENT_CONFIG_INVALID", "RUST_CONTENT_API_ORIGIN is invalid.", {
        service: "content",
      }),
      { status: 503 },
    );
  }
}

export function badRequest(message: string, code = "VALIDATION_ERROR"): Response {
  return Response.json(errorEnvelope(code, message, { service: "content" }), { status: 400 });
}

/// Reject `.`/`..` and separators before any URL construction. Decode repeatedly
/// so `%2e%2e`, `%252e%252e` and mixed encodings cannot slip through as segments.
export function unsafeSegment(raw: string): boolean {
  let value = raw;
  for (let _ = 0; _ < 4; _ += 1) {
    if (value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return true;
    }
    if (decoded === value) break;
    value = decoded;
  }
  return value === "." || value === ".." || value.includes("/") || value.includes("\\");
}

/// Catch traversal in a raw (not yet parsed) URL before the URL constructor can
/// normalize it away. Used for the legacy `?u=` alias.
export function hasTraversal(raw: string): boolean {
  let value = raw;
  for (let _ = 0; _ < 4; _ += 1) {
    if (value.split(/[/?#]/).some((part) => part === "." || part === "..")) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return true;
    }
    if (decoded === value) break;
    value = decoded;
  }
  return false;
}

/// Both `/api/content/img` and legacy `/api/img` apply the same raw-URL guard.
export function invalidImageSource(raw: string | null | undefined): boolean {
  if (!raw || hasTraversal(raw)) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol !== "https:" || Boolean(parsed.username || parsed.password);
  } catch {
    return true;
  }
}

/// Same-origin fetch to the configured Axum origin. Only safe conditional headers
/// are forwarded; browser credentials and upstream Set-Cookie never cross the BFF.
export async function forwardGet(request: Request, target: URL): Promise<Response> {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json(
      errorEnvelope("CONTENT_UPSTREAM_UNAVAILABLE", "Content service is unreachable.", {
        service: "content",
      }),
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // The CDN cache key ignores `?u=`, so forwarding Axum's immutable header
  // would serve the first image for every cover and page.
  if (target.pathname === "/api/content/img" || target.pathname === "/api/img") {
    responseHeaders.set("cache-control", "no-store");
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
