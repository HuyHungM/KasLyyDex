import type { NextRequest } from "next/server";
import { errorEnvelope, serviceUnavailableResponse } from "@/lib/contracts";

type Context = { params: Promise<{ path: string[] }> };

const RESPONSE_HEADERS = ["content-type", "cache-control", "etag", "last-modified"];
const REQUEST_HEADERS = ["accept", "accept-language", "if-none-match"];

function contentOrigin(): string | Response {
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

export async function GET(request: NextRequest, context: Context) {
  const origin = contentOrigin();
  if (typeof origin !== "string") return origin;

  const { path } = await context.params;
  const target = new URL(
    `${origin}/api/content/${path.map(encodeURIComponent).join("/")}`,
  );
  target.search = new URL(request.url).search;

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
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
