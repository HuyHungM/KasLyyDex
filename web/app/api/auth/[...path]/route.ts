import type { NextRequest } from "next/server";
import type { AccountIdentity } from "@/lib/auth/identity";
import {
  AuthRequestError,
  authErrorResponse,
  getAuth,
  authSessionSecret,
  googleSignIn,
} from "@/lib/auth/server";
import { clearSessionCookie, createSessionToken, setSessionCookie } from "@/lib/auth/session";
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

function requireOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(origin).origin === new URL(request.url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    throw new AuthRequestError(403, "AUTH_REQUEST_REJECTED", "Cross-origin auth requests are not allowed.");
  }
}

type AuthInput =
  | { kind: "google"; idToken: string }
  | { kind: "password"; email: string; password: string; name?: string };

async function credentials(request: Request): Promise<AuthInput | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  const idToken = typeof payload.idToken === "string"
    ? payload.idToken
    : typeof payload.credential === "string" ? payload.credential : null;
  if (idToken) return { kind: "google", idToken };
  const { email, password, name } = payload;
  if (typeof email !== "string" || typeof password !== "string") return null;
  return { kind: "password", email, password, name: typeof name === "string" ? name : undefined };
}

async function withCookie(request: Request, identity: AccountIdentity, response: Response): Promise<Response> {
  const secure = new URL(request.url).protocol === "https:";
  setSessionCookie(response, await createSessionToken(identity, await authSessionSecret()), secure);
  return response;
}

async function handle(request: NextRequest, context: Context) {
  return withObservedRoute("auth", request, async () => {
    try {
      if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
      const { path } = await context.params;
      const action = path[0];

      if (action === "get-session") {
        return sessionResponse(await getAuth().getSession(request));
      }

      if (action === "config") {
        const config = await getAuth().config();
        return Response.json({ googleClientId: config?.clientId ?? null });
      }

      if (request.method === "GET") {
        if (action === "callback") return sessionResponse(await getAuth().getSession(request));
        return Response.json(errorEnvelope("NOT_FOUND", "Unknown auth route."), { status: 404 });
      }

      switch (action) {
        case "sign-in":
        case "sign-up":
        case "callback": {
          requireOrigin(request);
          const input = await credentials(request);
          if (!input) {
            if (action === "callback") return sessionResponse(await getAuth().getSession(request));
            return Response.json(errorEnvelope("INVALID_REQUEST", "Email and password are required."), {
              status: 400,
            });
          }
          if (input.kind === "google") {
            const identity = await googleSignIn(input.idToken);
            return withCookie(request, identity, sessionResponse(identity));
          }
          const identity = action === "sign-in"
            ? await getAuth().signIn(input.email, input.password)
            : await getAuth().signUp(input.email, input.password, input.name);
          return withCookie(request, identity, sessionResponse(identity));
        }
        case "sign-out": {
          requireOrigin(request);
          await getAuth().signOut();
          const response = Response.json({ ok: true });
          clearSessionCookie(response);
          return response;
        }
        default:
          return Response.json(errorEnvelope("NOT_FOUND", "Unknown auth route."), { status: 404 });
      }
    } catch (error) {
      const response = authErrorResponse(error);
      if (response) return response;
      if (error instanceof AuthRequestError) {
        return Response.json(errorEnvelope(error.code, error.message), { status: error.status });
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
