import "server-only";

import { getIdentityConfig, getUser, login, logout, signup } from "@netlify/identity";
import { errorEnvelope } from "../contracts";
import { logErrorEvent } from "../observability";
import { identityFromNetlifyUser, type AccountIdentity } from "./identity";

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

export function authErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AuthConfigurationError)) return null;
  logErrorEvent(error);
  const details: Record<string, string> = { service: "auth" };
  if (error.missing.length > 0) details.missing = error.missing.join(",");
  return Response.json(errorEnvelope(error.code, error.message, details), { status: 503 });
}

// Identity is provisioned by Netlify, so there is no application env config.
// Tests inject this provider instead of depending on a deployed Identity site.
export type IdentityProvider = {
  config: () => { url: string } | null;
  getUser: () => Promise<unknown>;
  login: (email: string, password: string) => Promise<unknown>;
  signup: (email: string, password: string) => Promise<unknown>;
  logout: () => Promise<void>;
};

const netlifyProvider: IdentityProvider = {
  config: getIdentityConfig,
  getUser,
  login,
  signup,
  logout,
};

let provider: IdentityProvider = netlifyProvider;

export function setIdentityProvider(next: IdentityProvider = netlifyProvider): void {
  provider = next;
}

function requireProvider(): IdentityProvider {
  if (!provider.config()) {
    throw new AuthConfigurationError(
      "AUTH_NOT_CONFIGURED",
      "Netlify Identity is not available in this runtime.",
    );
  }
  return provider;
}

// Next route handlers do not always receive Netlify's Functions context, so the
// SDK's server getUser() cannot see the browser-set nf_jwt cookie. Verify the
// cookie directly against Identity instead of trusting the JWT payload.
export async function sessionFromJwt(token: string): Promise<AccountIdentity | null> {
  const config = requireProvider().config();
  if (!config?.url) return null;
  let response: Response;
  try {
    response = await fetch(`${config.url}/user`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  return identityFromNetlifyUser(await response.json().catch(() => null));
}

export type NetlifyIdentityAdapter = {
  getSession(): Promise<AccountIdentity | null>;
  signIn(email: string, password: string): Promise<AccountIdentity | null>;
  signUp(email: string, password: string): Promise<AccountIdentity | null>;
  signOut(): Promise<void>;
};

// Lazy so builds and unauthenticated public routes need no Identity runtime.
export function getAuth(): NetlifyIdentityAdapter {
  return {
    async getSession() {
      return identityFromNetlifyUser(await requireProvider().getUser());
    },
    async signIn(email, password) {
      return identityFromNetlifyUser(await requireProvider().login(email, password));
    },
    async signUp(email, password) {
      return identityFromNetlifyUser(await requireProvider().signup(email, password));
    },
    async signOut() {
      await requireProvider().logout();
    },
  };
}
