import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

// Fixture-only: the Identity provider is injected below, so no live Netlify
// project, OAuth tenant or credential is needed.
const { identityFromNetlifyUser } = await import("../lib/auth/identity.ts");
const { authTokenParams } = await import("../lib/auth/callback.ts");
const {
  AuthConfigurationError,
  authErrorResponse,
  getAuth,
  setIdentityProvider,
} = await import("../lib/auth/server.ts");
const route = await import("../app/api/auth/[...path]/route.ts");

const fixtureUser = {
  id: "identity-user-1",
  email: "reader@example.com",
  email_verified: true,
  user_metadata: { full_name: "Reader" },
};

const configuredProvider = (user = fixtureUser) => ({
  config: () => ({ url: "https://example.test/.netlify/identity" }),
  getUser: async () => user,
  login: async () => user,
  signup: async () => user,
  logout: async () => {},
});

const sessionRequest = new Request("https://example.test/api/auth/get-session");
const sessionContext = { params: Promise.resolve({ path: ["get-session"] }) };
const sessionBody = {
  session: { id: fixtureUser.id },
  user: {
    id: fixtureUser.id,
    email: fixtureUser.email,
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

test("a Netlify user maps into an AccountIdentity with verified email", () => {
  assert.deepEqual(identityFromNetlifyUser(fixtureUser), {
    id: fixtureUser.id,
    email: fixtureUser.email,
    emailVerified: true,
    name: "Reader",
    image: null,
    sessionId: fixtureUser.id,
  });
});

test("callback accepts Identity tokens from hash or query", () => {
  assert.equal(authTokenParams("#access_token=abc&expires_in=1", "").get("access_token"), "abc");
  assert.equal(authTokenParams("", "?access_token=abc&expires_in=1").get("access_token"), "abc");
  assert.equal(authTokenParams("", "?q=one%20piece"), null);
  assert.equal(authTokenParams("#section=intro", ""), null);
});

test("unusable identity users are rejected", () => {
  assert.equal(identityFromNetlifyUser({ ...fixtureUser, id: undefined }), null);
  assert.equal(identityFromNetlifyUser({ ...fixtureUser, id: "x".repeat(257) }), null);
  assert.equal(identityFromNetlifyUser({ ...fixtureUser, email_verified: false }), null);
  assert.equal(identityFromNetlifyUser({
    ...fixtureUser,
    email_verified: false,
    confirmedAt: "2026-01-01T00:00:00.000Z",
  }), null);
  assert.equal(identityFromNetlifyUser({
    ...fixtureUser,
    email_verified: true,
    emailVerified: false,
    confirmedAt: "2026-01-01T00:00:00.000Z",
  }), null);
});

test("client-supplied privilege fields never reach the identity", () => {
  const identity = identityFromNetlifyUser({
    ...fixtureUser,
    role: "admin",
    level: 99,
    totalXp: 1_000_000,
    percent: 100,
    pageCount: 999,
    app_metadata: { role: "admin", roles: ["admin"] },
    user_metadata: { ...fixtureUser.user_metadata, role: "admin", level: 99 },
  });
  assert.deepEqual(Object.keys(identity).sort(), [
    "email", "emailVerified", "id", "image", "name", "sessionId",
  ]);
  assert.equal(identity.emailVerified, true);
});

test("unavailable Identity returns a structured AUTH_NOT_CONFIGURED 503", async () => {
  setIdentityProvider({
    ...configuredProvider(),
    config: () => null,
  });
  await assert.rejects(
    () => getAuth().getSession(),
    (error) => error instanceof AuthConfigurationError
      && error.code === "AUTH_NOT_CONFIGURED",
  );

  const res = await route.GET(sessionRequest, sessionContext);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
  assert.equal(body.error.details.service, "auth");

  const direct = authErrorResponse(new AuthConfigurationError("AUTH_NOT_CONFIGURED", "no identity"));
  assert.equal(direct?.status, 503);
  assert.equal((await direct.json()).error.details.service, "auth");
});

test("get-session keeps the existing session/user response shape", async () => {
  setIdentityProvider(configuredProvider());
  const identity = await getAuth().getSession();
  assert.equal(identity.id, fixtureUser.id);
  assert.equal(identity.sessionId, fixtureUser.id);

  const res = await route.GET(sessionRequest, sessionContext);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), sessionBody);
});

test("get-session uses the nf_jwt cookie when the SDK has no server context", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: init?.headers?.authorization });
    return new Response(JSON.stringify(fixtureUser), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    setIdentityProvider({ ...configuredProvider(), getUser: async () => null });
    const request = new Request("https://example.test/api/auth/get-session", {
      headers: { cookie: "nf_jwt=jwt-from-oauth-callback" },
    });
    const res = await route.GET(request, sessionContext);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), sessionBody);
    assert.match(calls[0].url, /\/user$/);
    assert.equal(calls[0].authorization, "Bearer jwt-from-oauth-callback");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("sign-in, sign-up, sign-out and callback succeed with an injected provider", async () => {
  const calls = [];
  setIdentityProvider({
    ...configuredProvider(),
    login: async (...args) => { calls.push(["login", ...args]); return fixtureUser; },
    signup: async (...args) => { calls.push(["signup", ...args]); return fixtureUser; },
    logout: async () => { calls.push(["logout"]); },
  });

  for (const action of ["sign-in", "sign-up"]) {
    const res = await route.POST(post(action, { email: fixtureUser.email, password: "secret123" }), context(action));
    assert.equal(res.status, 200, action);
    assert.deepEqual(await res.json(), sessionBody, action);
  }

  const out = await route.POST(post("sign-out"), context("sign-out"));
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { ok: true });

  const callback = await route.POST(post("callback"), context("callback"));
  assert.equal(callback.status, 200);
  assert.deepEqual(await callback.json(), sessionBody);

  assert.deepEqual(calls, [
    ["login", fixtureUser.email, "secret123"],
    ["signup", fixtureUser.email, "secret123"],
    ["logout"],
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

test("client auth sends flat signup metadata and ignores the OAuth redirect throw", async () => {
  const client = await readFile(new URL("../lib/auth/client.ts", import.meta.url), "utf8");
  assert.match(client, /signup\(email, password, name \? \{ full_name: name \} : undefined\)/);
  assert.doesNotMatch(client, /data:\s*\{\s*full_name/);
  assert.match(client, /instanceof AuthError && error\.message === "Redirecting to OAuth provider"/);
});
