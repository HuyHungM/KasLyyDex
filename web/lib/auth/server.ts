import "server-only";

import { createNeonAuth, type NeonAuth } from "@neon/auth/next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorEnvelope } from "../contracts";

export type AuthConfig = {
  baseUrl: string;
  cookieSecret: string;
  origin: string;
};

type AuthErrorCode = "AUTH_NOT_CONFIGURED" | "AUTH_CONFIG_INVALID";

export class AuthConfigurationError extends Error {
  readonly code: AuthErrorCode;
  readonly missing: string[];

  constructor(code: AuthErrorCode, message: string, missing: string[] = []) {
    super(message);
    this.name = "AuthConfigurationError";
    this.code = code;
    this.missing = missing;
  }
}

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const baseUrl = env.NEON_AUTH_BASE_URL?.trim();
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET?.trim();
  const missing = [
    ...(!baseUrl ? ["NEON_AUTH_BASE_URL"] : []),
    ...(!cookieSecret ? ["NEON_AUTH_COOKIE_SECRET"] : []),
  ];
  if (missing.length > 0) {
    throw new AuthConfigurationError(
      "AUTH_NOT_CONFIGURED",
      "Neon Managed Auth is not configured.",
      missing,
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl!);
  } catch {
    throw new AuthConfigurationError("AUTH_CONFIG_INVALID", "NEON_AUTH_BASE_URL must be a URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AuthConfigurationError("AUTH_CONFIG_INVALID", "NEON_AUTH_BASE_URL is invalid.");
  }
  if (cookieSecret!.length < 32) {
    throw new AuthConfigurationError(
      "AUTH_CONFIG_INVALID",
      "NEON_AUTH_COOKIE_SECRET must be at least 32 characters.",
    );
  }
  return { baseUrl: url.toString().replace(/\/$/, ""), cookieSecret: cookieSecret!, origin: url.origin };
}

export function authErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AuthConfigurationError)) return null;
  const details: Record<string, string> = { service: "auth" };
  if (error.missing.length > 0) details.missing = error.missing.join(",");
  return Response.json(errorEnvelope(error.code, error.message, details), { status: 503 });
}

let auth: NeonAuth | undefined;

// createNeonAuth validates the cookie secret eagerly, so construct it only on
// the first route that actually needs authentication.
export function getAuth(): NeonAuth {
  if (!auth) {
    const config = readAuthConfig();
    auth = createNeonAuth({
      baseUrl: config.baseUrl,
      cookies: { secret: config.cookieSecret, sameSite: "lax" },
    });
  }
  return auth;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksFor = "";

export async function verifyNeonJwt(token: string) {
  try {
    const config = readAuthConfig();
    if (!jwks || jwksFor !== config.baseUrl) {
      jwks = createRemoteJWKSet(new URL(`${config.baseUrl}/.well-known/jwks.json`));
      jwksFor = config.baseUrl;
    }
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["EdDSA"],
      issuer: config.origin,
      audience: config.origin,
    });
    return payload;
  } catch {
    return null;
  }
}
