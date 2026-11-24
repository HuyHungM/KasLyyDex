import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

const { identityFromVerifiedUser } = await import("../lib/auth/identity.ts");
const { authTokenParams } = await import("../lib/auth/callback.ts");
const {
  AuthConfigurationError,
  authErrorResponse,
  getAuth,
  setIdentityProvider,
} = await import("../lib/auth/server.ts");
const { cookieToken, createSessionToken, readSessionToken, SESSION_COOKIE } = await import("../lib/auth/session.ts");
const route = await import("../app/api/auth/[...path]/route.ts");

const SECRET = "fixture-session-secret-with-at-least-32-chars";
const fixtureUser = {
  id: "google|identity-user-1",
  email: "reader@example.com",
  email_verified: true,
  name: "Reader",
  picture: null,
};

const identity = {
  id: fixtureUser.id,
  email: fixtureUser.email,
  emailVerified: true,
  name: "Reader",
  image: null,
  sessionId: fixtureUser.id,
};

const configuredProvider = (user = fixtureUser) => ({
  config: async () => ({ secret: SECRET, clientId: "google-client-id" }),
  getSession: async () => identityFromVerifiedUser(user),
  signIn: async () => identity,
  signUp: async () => identity,
  signOut: async () => {},
  google: async () => identity,
});

const sessionRequest = new Request("https://example.test/api/auth/get-session");
const sessionContext = { params: Promise.resolve({ path: ["get-session"] }) };
const sessionBody = {
  session: { id: identity.sessionId },
  user: {
    id: identity.id,
    email: identity.email,
    emailVerified: true,
    name: "Reader",
    image: null,
  },
};

function post(action, body) {
  return new Request(`https://example.test/api/auth/${action}`, {
    method: "POST",
    headers: { origin: "https://example.test", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context(action) {
  return { params: Promise.resolve({ path: [action] }) };
}

afterEach(() => setIdentityProvider());

test("a verified user maps into an AccountIdentity", () => {
  assert.deepEqual(identityFromVerifiedUser(fixtureUser), identity);
});

test("callback accepts Google credentials from hash or query", () => {
  assert.equal(authTokenParams("#credential=abc", "").get("credential"), "abc");
  assert.equal(authTokenParams("", "?id_token=abc").get("id_token"), "abc");
  assert.equal(authTokenParams("", "?q=one%20piece"), null);
});

test("unusable verified users are rejected", () => {
  assert.equal(identityFromVerifiedUser({ ...fixtureUser, id: undefined, sub: undefined }), null);
  assert.equal(identityFromVerifiedUser({ ...fixtureUser, id: "x".repeat(257) }), null);
  assert.equal(identityFromVerifiedUser({ ...fixtureUser, email_verified: false }), null);
  assert.equal(identityFromVerifiedUser({ ...fixtureUser, emailVerified: false }), null);
});

test("client-supplied privilege fields never reach the identity", () => {
  const resolved = identityFromVerifiedUser({
    ...fixtureUser,
    role: "admin",
    level: 99,
    totalXp: 1_000_000,
    app_metadata: { role: "admin" },
    user_metadata: { role: "admin" },
  });
  assert.deepEqual(Object.keys(resolved).sort(), [
    "email", "emailVerified", "id", "image", "name", "sessionId",
  ]);
  assert.equal(resolved.emailVerified, true);
});

test("unavailable session auth returns a structured AUTH_NOT_CONFIGURED 503", async () => {
  setIdentityProvider({
    ...configuredProvider(),
    config: async () => null,
    getSession: async () => {
      throw new AuthConfigurationError("AUTH_NOT_CONFIGURED", "Session authentication is not configured in this runtime.");
    },
  });
  await assert.rejects(
    () => getAuth().getSession(),
    (error) => error instanceof AuthConfigurationError && error.code === "AUTH_NOT_CONFIGURED",
  );

  const res = await route.GET(sessionRequest, sessionContext);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "AUTH_NOT_CONFIGURED");

  const direct = authErrorResponse(new AuthConfigurationError("AUTH_NOT_CONFIGURED", "no secret"));
  assert.equal(direct?.status, 503);
  assert.equal((await direct.json()).error.details.service, "auth");
});

test("missing GOOGLE_CLIENT_ID fails closed with a structured error", async () => {
  setIdentityProvider({
    ...configuredProvider(),
    config: async () => ({ secret: SECRET, clientId: null }),
    google: async () => {
      throw new AuthConfigurationError("AUTH_CONFIG_INVALID", "Google sign-in is not configured.", ["GOOGLE_CLIENT_ID"]);
    },
  });
  const res = await route.POST(post("callback", { credential: "id-token" }), context("callback"));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, "AUTH_CONFIG_INVALID");
  assert.equal(body.error.details.missing, "GOOGLE_CLIENT_ID");
});

test("get-session keeps the existing session/user response shape", async () => {
  setIdentityProvider(configuredProvider());
  const response = await route.GET(sessionRequest, sessionContext);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sessionBody);
});

test("signed session cookies are HttpOnly SameSite=Lax and resolve back to a session", async () => {
  setIdentityProvider(configuredProvider());
  const signIn = await route.POST(post("sign-in", { email: "reader@example.com", password: "secret123" }), context("sign-in"));
  const cookie = signIn.headers.get("set-cookie");
  assert.match(cookie ?? "", new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(cookie ?? "", /HttpOnly/);
  assert.match(cookie ?? "", /SameSite=Lax/);

  const token = cookieToken(cookie);
  assert.equal((await readSessionToken(token, SECRET))?.id, identity.id);
  const forged = await readSessionToken(token, "another-secret-with-at-least-32-chars!");
  assert.equal(forged, null);

  const session = await createSessionToken(identity, SECRET);
  setIdentityProvider({
    ...configuredProvider(),
    getSession: async (request) => readSessionToken(cookieToken(request?.headers.get("cookie") ?? null), SECRET),
  });
  const res = await route.GET(new Request("https://example.test/api/auth/get-session", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` },
  }), sessionContext);
  assert.deepEqual(await res.json(), sessionBody);
});

test("cross-origin auth mutations are rejected", async () => {
  setIdentityProvider(configuredProvider());
  const request = new Request("https://example.test/api/auth/sign-out", {
    method: "POST",
    headers: { origin: "https://evil.test" },
  });
  const res = await route.POST(request, { params: Promise.resolve({ path: ["sign-out"] }) });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "AUTH_REQUEST_REJECTED");
});

test("only GET and POST are allowed on the auth route", async () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const request = new Request("https://example.test/api/auth/get-session", { method });
    const res = await route[method](request, sessionContext);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, POST", method);
  }
});

test("sign-in, sign-up, sign-out, Google callback and config keep their contracts", async () => {
  const calls = [];
  setIdentityProvider({
    ...configuredProvider(),
    signIn: async (...args) => { calls.push(["signIn", ...args]); return identity; },
    signUp: async (...args) => { calls.push(["signUp", ...args]); return identity; },
    google: async (...args) => { calls.push(["google", ...args]); return identity; },
    signOut: async () => { calls.push(["signOut"]); },
  });

  for (const action of ["sign-in", "sign-up"]) {
    const res = await route.POST(post(action, { email: fixtureUser.email, password: "secret123" }), context(action));
    assert.equal(res.status, 200, action);
    assert.deepEqual(await res.json(), sessionBody, action);
  }
  const google = await route.POST(post("callback", { credential: "google-id-token" }), context("callback"));
  assert.deepEqual(await google.json(), sessionBody);

  const out = await route.POST(post("sign-out"), context("sign-out"));
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { ok: true });
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const config = await route.GET(new Request("https://example.test/api/auth/config"), context("config"));
  assert.deepEqual(await config.json(), { googleClientId: "google-client-id" });

  assert.deepEqual(calls, [
    ["signIn", fixtureUser.email, "secret123"],
    ["signUp", fixtureUser.email, "secret123", undefined],
    ["google", "google-id-token"],
    ["signOut"],
  ]);
});

test("callback tokens are handled globally, not only on the account page", async () => {
  const [layout, handler, panel] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-callback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/account/AuthPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /import AuthCallback from "@\/components\/auth-callback"/);
  assert.match(layout, /<AuthCallback \/>/);
  assert.match(handler, /await handleAuthCallback\(\)/);
  assert.match(handler, /authTokenParams\(/);
  assert.match(handler, /refreshSession\(\)/);
  assert.match(handler, /role="alert"/);
  assert.doesNotMatch(panel, /handleAuthCallback/, "the account panel must not process callbacks twice");
});

test("client auth uses Google Identity Services credentials, not a managed SDK", async () => {
  const client = await readFile(new URL("../lib/auth/client.ts", import.meta.url), "utf8");
  assert.match(client, /accounts\.google\.com\/gsi\/client/);
  assert.match(client, /\/api\/auth\/config/);
  assert.match(client, /\/api\/auth\/callback/);
  assert.doesNotMatch(client, /@netlify\/identity/);
});
