import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { startHttpServer, startNext, stop } from "./test-helpers.mjs";

// These tests exercise the real Neon SDK adapter against a local fixture upstream.
// They are fixture-only: no Neon project, Google OAuth tenant, or live session is used.
const { AuthConfigurationError, getAuth, readAuthConfig, verifyNeonJwt } = await import(
  "../lib/auth/server.ts"
);

let unconfigured;
let configuredFixture;
let configuredNext;

before(async () => {
  unconfigured = await startNext();
  configuredFixture = await startHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "__Secure-neon-auth.session_token=fixture; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(JSON.stringify({ ok: true }));
  });
  configuredNext = await startNext({
    NEON_AUTH_BASE_URL: `${configuredFixture.baseUrl}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
  });
});

after(async () => {
  await stop(configuredNext?.child);
  await stop(unconfigured?.child);
  await configuredFixture?.close();
});

test("auth config validates explicit server env and never invents credentials", () => {
  assert.throws(
    () => readAuthConfig({}),
    (error) => error instanceof AuthConfigurationError
      && error.code === "AUTH_NOT_CONFIGURED"
      && error.missing.includes("NEON_AUTH_BASE_URL")
      && error.missing.includes("NEON_AUTH_COOKIE_SECRET"),
  );
  assert.throws(
    () => readAuthConfig({ NEON_AUTH_BASE_URL: "not a url", NEON_AUTH_COOKIE_SECRET: "x".repeat(40) }),
    (error) => error.code === "AUTH_CONFIG_INVALID",
  );
  assert.throws(
    () => readAuthConfig({ NEON_AUTH_BASE_URL: "https://auth.example.com", NEON_AUTH_COOKIE_SECRET: "short" }),
    (error) => error.code === "AUTH_CONFIG_INVALID",
  );
  const config = readAuthConfig({
    NEON_AUTH_BASE_URL: "https://ep-1.neonauth.example.com/neondb/auth",
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
  });
  assert.equal(config.origin, "https://ep-1.neonauth.example.com");
  assert.equal(config.baseUrl, "https://ep-1.neonauth.example.com/neondb/auth");
});

test("the real Neon SDK creates a lazy server instance only with valid config", () => {
  const previous = process.env.NEON_AUTH_BASE_URL;
  const previousSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  try {
    process.env.NEON_AUTH_BASE_URL = "https://ep-1.neonauth.example.com/neondb/auth";
    process.env.NEON_AUTH_COOKIE_SECRET = "fixture-secret-with-at-least-32-characters";
    const auth = getAuth();
    assert.equal(typeof auth.handler, "function");
    assert.equal(typeof auth.getSession, "function");
    assert.equal(typeof auth.signIn.email, "function");
  } finally {
    if (previous === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previous;
    if (previousSecret === undefined) delete process.env.NEON_AUTH_COOKIE_SECRET;
    else process.env.NEON_AUTH_COOKIE_SECRET = previousSecret;
  }
});

test("missing auth config returns structured 503 only on auth routes", async () => {
  for (const [path, init] of [
    ["/api/auth/get-session", undefined],
    ["/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", password: "secret" }),
    }],
  ]) {
    const res = await fetch(`${unconfigured.baseUrl}${path}`, init);
    assert.equal(res.status, 503, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED", path);
    assert.equal(body.error.details.service, "auth", path);
    assert.deepEqual(body.error.details.missing?.split(",").sort(), [
      "NEON_AUTH_BASE_URL",
      "NEON_AUTH_COOKIE_SECRET",
    ]);
    assert.deepEqual(res.headers.getSetCookie(), [], "must not mint a fake session");
  }

  const health = await fetch(`${unconfigured.baseUrl}/api/v1/health`);
  assert.equal(health.status, 200);
});

test("fixture-only SDK proxy forwards email/password and Google provider requests", async () => {
  const emailRes = await fetch(`${configuredNext.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "reader@example.com", password: "fixture-password" }),
  });
  assert.equal(emailRes.status, 200);

  const googleRes = await fetch(`${configuredNext.baseUrl}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "/api/auth/callback/google" }),
  });
  assert.equal(googleRes.status, 200);

  assert.ok(configuredFixture.requests.some((r) => r.url.includes("sign-in/email")));
  const googleRequest = configuredFixture.requests.find((r) => r.url.includes("sign-in/social"));
  assert.ok(googleRequest);
  assert.match(googleRequest.body, /"provider":"google"/);
});

test("fixture-only SDK proxy rewrites session cookies to Secure and HttpOnly in production", async () => {
  const res = await fetch(`${configuredNext.baseUrl}/api/auth/get-session`);
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  for (const cookie of cookies) {
    assert.match(cookie, /__Secure-neon-auth/);
    assert.match(cookie, /;\s*Secure\b/i, cookie);
    assert.match(cookie, /;\s*HttpOnly\b/i, cookie);
    assert.match(cookie, /SameSite=Lax/i, cookie);
  }
});

test("fixture-only JWT/JWKS verifier checks EdDSA signature, issuer and audience", async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fixture-key";
  jwk.use = "sig";
  jwk.alg = "EdDSA";

  const fixture = await startHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const previousBaseUrl = process.env.NEON_AUTH_BASE_URL;
  const previousSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  try {
    const baseUrl = `${fixture.baseUrl}/neondb/auth`;
    process.env.NEON_AUTH_BASE_URL = baseUrl;
    process.env.NEON_AUTH_COOKIE_SECRET = "fixture-secret-with-at-least-32-characters";
    const origin = new URL(baseUrl).origin;
    const sign = (issuer) => new SignJWT({ sub: "opaque-user-id" })
      .setProtectedHeader({ alg: "EdDSA", kid: "fixture-key" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(privateKey);

    const valid = await verifyNeonJwt(await sign(origin));
    assert.equal(valid?.sub, "opaque-user-id");
    assert.equal(await verifyNeonJwt(await sign("https://wrong-issuer.example.com")), null);
    assert.ok(fixture.requests.some((r) => r.url.includes(".well-known/jwks.json")));
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousBaseUrl;
    if (previousSecret === undefined) delete process.env.NEON_AUTH_COOKIE_SECRET;
    else process.env.NEON_AUTH_COOKIE_SECRET = previousSecret;
    await fixture.close();
  }
});
