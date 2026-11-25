import { SignJWT, jwtVerify } from "jose";
import { identityFromSession, type AccountIdentity } from "./identity";

export const SESSION_COOKIE = "kaslyydex_session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

const ISSUER = "kaslyydex";
const AUDIENCE = "kaslyydex";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(identity: AccountIdentity, secret: string, now = Date.now()): Promise<string> {
  return new SignJWT({
    session: { id: identity.sessionId || identity.id },
    user: {
      id: identity.id,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
      image: identity.image,
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + SESSION_MAX_AGE)
    .sign(key(secret));
}

export async function readSessionToken(token: string | null, secret: string): Promise<AccountIdentity | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return identityFromSession(payload);
  } catch {
    return null;
  }
}

export function cookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.headers.append("set-cookie", [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${SESSION_MAX_AGE}`,
  ].join("; "));
}

export function clearSessionCookie(response: Response): void {
  response.headers.append("set-cookie", [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; "));
}
