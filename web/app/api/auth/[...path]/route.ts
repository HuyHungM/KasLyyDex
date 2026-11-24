import { AuthError, verifyRequestOrigin } from "@netlify/identity";
import type { NextRequest } from "next/server";
import type { AccountIdentity } from "@/lib/auth/identity";
import { authErrorResponse, getAuth, sessionFromJwt } from "@/lib/auth/server";
import { errorEnvelope } from "@/lib/contracts";
import { withObservedRoute } from "@/lib/observability";

type Context = { params: Promise<{ path: string[] }> };

const ALLOW = "GET, POST";

function methodNotAllowed() {
  return Response.json(errorEnvelope("METHOD_NOT_ALLOWED", "Method not allowed."), {
    status: 405,
    headers: { Allow: ALLOW },
  });
}

function sessionResponse(identity: AccountIdentity | null) {
  return Response.json({
    session: identity ? { id: identity.sessionId } : null,
    user: identity
      ? {
        id: identity.id,
        email: identity.email,
        emailVerified: identity.emailVerified,
        name: identity.name,
        image: identity.image,
      }
      : null,
  });
}

async function credentials(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  return { email, password };
}

async function handle(request: NextRequest, context: Context) {
  const debug = new URL(request.url).searchParams.get("authdebug");
  if (debug) {
    console.info("[auth-debug] callback-url", JSON.stringify({ kind: debug.slice(0, 40) }));
  }
  return withObservedRoute("auth", request, async () => {
    try {
      if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
      const { path } = await context.params;
      const action = path[0];
      if (action === "get-session") {
        const cookie = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(request.headers.get("cookie") ?? "");
        const token = cookie ? decodeURIComponent(cookie[1]) : null;
        console.info("[auth-debug] get-session", JSON.stringify({
          hasCookie: Boolean(token),
          tokenLength: token?.length ?? 0,
        }));
        const identity = token ? await sessionFromJwt(token) : null;
        console.info("[auth-debug] get-session result", JSON.stringify({
          fromCookie: Boolean(identity),
          fallback: !identity,
        }));
        return sessionResponse(identity ?? await getAuth().getSession());
      }

      if (request.method === "GET") {
        return Response.json(errorEnvelope("NOT_FOUND", "Unknown auth route."), { status: 404 });
      }

      switch (action) {
        case "sign-in":
        case "sign-up": {
          verifyRequestOrigin(request);
          const input = await credentials(request);
          if (!input) {
            return Response.json(errorEnvelope("INVALID_REQUEST", "Email and password are required."), {
              status: 400,
            });
          }
          const identity = action === "sign-in"
            ? await getAuth().signIn(input.email, input.password)
            : await getAuth().signUp(input.email, input.password);
          return sessionResponse(identity);
        }
        case "sign-out":
          verifyRequestOrigin(request);
          await getAuth().signOut();
          return Response.json({ ok: true });
        case "callback":
          // The browser SDK processes the OAuth hash; the route reports the
          // resulting session rather than running browser-only code on server.
          return sessionResponse(await getAuth().getSession());
        default:
          return Response.json(errorEnvelope("NOT_FOUND", "Unknown auth route."), { status: 404 });
      }
    } catch (error) {
      const response = authErrorResponse(error);
      if (response) return response;
      if (error instanceof AuthError && error.status) {
        return Response.json(errorEnvelope("AUTH_REQUEST_REJECTED", error.message), {
          status: error.status,
        });
      }
      throw error;
    }
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
