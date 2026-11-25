import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { errorEnvelope } from "../contracts";
import { logErrorEvent } from "../observability";
import { getDatabase } from "../db/client";
import { authUsers } from "../db/schema";
import type { WorkerEnv } from "../worker-env";
import { workerEnv } from "../worker-env";
import { identityFromVerifiedUser, type AccountIdentity } from "./identity";
import { cookieToken, readSessionToken, SESSION_COOKIE } from "./session";

async function currentRequest(): Promise<Request | undefined> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    return new Request("http://local", {
      headers: token ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } : {},
    });
  } catch {
    return undefined;
  }
}

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

export class AuthRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.code = code;
  }
}

export function authErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AuthConfigurationError)) return null;
  logErrorEvent(error);
  const details: Record<string, string> = { service: "auth" };
  if (error.missing.length > 0) details.missing = error.missing.join(",");
  return Response.json(errorEnvelope(error.code, error.message, details), { status: 503 });
}

export type AuthConfig = { secret: string; clientId: string | null };

// Tests inject this provider; production uses Worker bindings and D1 only.
export type IdentityProvider = {
  config: () => Promise<AuthConfig | null>;
  getSession: (request?: Request) => Promise<AccountIdentity | null>;
  signIn: (email: string, password: string) => Promise<AccountIdentity>;
  signUp: (email: string, password: string, name?: string) => Promise<AccountIdentity>;
  signOut: () => Promise<void>;
  google: (idToken: string) => Promise<AccountIdentity>;
};

async function workerConfig(): Promise<AuthConfig | null> {
  const env: WorkerEnv = await workerEnv();
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return { secret, clientId: env.GOOGLE_CLIENT_ID?.trim() || null };
}

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
}

// Workers WebCrypto rejects iteration counts above 100000.
const PBKDF2_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    256,
  ));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "pbkdf2" || !saltHex || !hashHex) return false;
  const expected = fromHex(hashHex);
  const actual = await derive(password, fromHex(saltHex), Number(iterations));
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const workerProvider: IdentityProvider = {
  config: workerConfig,
  async getSession(request) {
    const config = await requireConfig();
    const active = request ?? await currentRequest();
    return readSessionToken(cookieToken(active?.headers.get("cookie") ?? null), config.secret);
  },
  async signIn(email, password) {
    const normalized = email.trim().toLowerCase();
    const rows = await getDatabase().select().from(authUsers)
      .where(eq(authUsers.email, normalized)).limit(1);
    const user = rows[0];
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new AuthRequestError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    const identity = identityFromVerifiedUser(user);
    if (!identity) throw new AuthRequestError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    return identity;
  },
  async signUp(email, password, name) {
    const normalized = email.trim().toLowerCase();
    const existing = await getDatabase().select({ id: authUsers.id }).from(authUsers)
      .where(eq(authUsers.email, normalized)).limit(1);
    if (existing.length > 0) throw new AuthRequestError(409, "EMAIL_IN_USE", "That email is already registered.");
    const id = `local:${crypto.randomUUID()}`;
    const identity: AccountIdentity = {
      id, email: normalized, emailVerified: true, name: name?.trim() || null,
      image: null, sessionId: id,
    };
    await getDatabase().insert(authUsers).values({
      id, email: normalized, emailVerified: true, name: identity.name,
      passwordHash: await hashPassword(password),
    });
    return identity;
  },
  async signOut() {},
  async google(idToken) {
    const config = await requireConfig();
    if (!config.clientId) {
      throw new AuthConfigurationError(
        "AUTH_CONFIG_INVALID",
        "Google sign-in is not configured.",
        ["GOOGLE_CLIENT_ID"],
      );
    }
    const { payload } = await jwtVerify(idToken, GOOGLE_CERTS, {
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      audience: config.clientId,
      algorithms: ["RS256"],
    });
    const identity = identityFromVerifiedUser(payload);
    if (!identity?.email || !identity.emailVerified) {
      throw new AuthRequestError(401, "GOOGLE_TOKEN_REJECTED", "Google did not return a verified email.");
    }
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) throw new AuthRequestError(401, "GOOGLE_TOKEN_REJECTED", "Google token has no subject.");
    const db = getDatabase();
    const bySub = await db.select().from(authUsers).where(eq(authUsers.googleSub, sub)).limit(1);
    if (bySub[0]) return identityFromVerifiedUser(bySub[0]) ?? identity;
    const id = `google:${sub}`;
    const byEmail = await db.select().from(authUsers).where(eq(authUsers.email, identity.email)).limit(1);
    if (byEmail[0]) {
      await db.update(authUsers).set({ googleSub: sub, updatedAt: new Date() }).where(eq(authUsers.id, byEmail[0].id));
      return identityFromVerifiedUser({ ...byEmail[0], id: byEmail[0].id }) ?? identity;
    }
    await db.insert(authUsers).values({
      id, email: identity.email, emailVerified: true, name: identity.name,
      image: identity.image, googleSub: sub,
    });
    return { ...identity, id, sessionId: id };
  },
};

let provider: IdentityProvider = workerProvider;

export function setIdentityProvider(next: IdentityProvider = workerProvider): void {
  provider = next;
}

async function requireConfig(): Promise<AuthConfig> {
  const config = await provider.config();
  if (!config) {
    throw new AuthConfigurationError(
      "AUTH_NOT_CONFIGURED",
      "Session authentication is not configured in this runtime.",
    );
  }
  return config;
}

export function getAuth(): IdentityProvider {
  return provider;
}

export async function authSessionSecret(): Promise<string> {
  return (await requireConfig()).secret;
}

export async function googleSignIn(idToken: string): Promise<AccountIdentity> {
  return provider.google(idToken);
}
