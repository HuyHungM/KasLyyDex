import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// Fixture-only: the Identity provider is injected below, so no live Netlify
// project, OAuth tenant or credential is needed.
const { identityFromNetlifyUser } = await import("../lib/auth/identity.ts");
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
  assert.deepEqual(await res.json(), {
    session: { id: fixtureUser.id },
    user: {
      id: fixtureUser.id,
      email: fixtureUser.email,
      emailVerified: true,
      name: "Reader",
      image: null,
    },
  });
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
