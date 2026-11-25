import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { logStructured, outcomeFor, redactSecrets, withObservedRoute, OBSERVED_OPERATIONS } = await import(
  "../lib/observability.ts"
);

test("redaction removes every credential form, including opaque tokens and cookies", () => {
  const input = [
    "Authorization: Bearer myopaqueapitoken123",
    "Cookie: connect.sid=s%3Axyz; theme=cookie-alpha-123",
    "cookie: first=cookie-beta-456; second=cookie-gamma-789",
    "X-Forwarded-Authorization: Bearer forwardedopaque789",
    "Proxy-Authorization: Basic cHJveHljb3BhcXVlNDU2",
    "Set-Cookie: session=abc; Path=/; HttpOnly",
    "GET /callback?code=oauthcode123456&token=opaque-query-999 HTTP/1.1",
    "DATABASE_URL=" + "postgres" + "ql://reader:dbpassword123@db.example.com/kaslyydex",
    "EMAIL=reader@example.com",
  ].join(" ");
  const redacted = redactSecrets(input);
  for (const secret of [
    "myopaqueapitoken123", "connect.sid=s%3Axyz", "cookie-alpha-123",
    "cookie-beta-456", "cookie-gamma-789", "forwardedopaque789",
    "cHJveHljb3BhcXVlNDU2", "session=abc", "oauthcode123456",
    "opaque-query-999", "dbpassword123", "db.example.com", "reader@example.com",
  ]) {
    assert.ok(!redacted.includes(secret), `${secret} leaked`);
  }
  assert.doesNotMatch(redacted, /Bearer\s+\S/i, "bearer value survived");
  assert.match(redacted, /\[redacted/);
});

test("redaction handles repeated headers and header names without a colon", () => {
  const redacted = redactSecrets(
    "authorization:Bearer firstopaque111 authorization Bearer secondopaque222 " +
    "COOKIE a=firstcookie333; b=secondcookie444",
  );
  for (const secret of ["firstopaque111", "secondopaque222", "firstcookie333", "secondcookie444"]) {
    assert.ok(!redacted.includes(secret), `${secret} leaked`);
  }
});

test("redaction keeps ordinary prose without credential separators", () => {
  const prose = "This ticket belongs to another account. Authorization is required.";
  assert.equal(redactSecrets(prose), prose);
});

test("logStructured redacts arbitrary field values and stays valid JSON", () => {
  const write = process.stderr.write.bind(process.stderr);
  let line = "";
  process.stderr.write = (chunk) => {
    line += String(chunk);
    return true;
  };
  try {
    logStructured("error", "error", {
      message: "Authorization: Bearer logfieldopaque999 Cookie: a=cookie-log-111; b=cookie-log-222 " +
        "code=oauthcodefromlog https://example.com/cb?token=querylogsecret333",
    });
  } finally {
    process.stderr.write = write;
  }
  for (const secret of ["logfieldopaque999", "cookie-log-111", "cookie-log-222", "oauthcodefromlog", "querylogsecret333"]) {
    assert.ok(!line.includes(secret), `${secret} leaked into structured log`);
  }
  const parsed = JSON.parse(line.trim());
  assert.equal(parsed.event, "error");
  assert.equal(parsed.level, "error");
  assert.equal(typeof parsed.message, "string");
});

test("observability source has no Vercel-only metric import", () => {
  const source = readFileSync(new URL("../lib/observability.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@vercel\/functions/);
});

test("metric outcomes are bounded and never echo request detail", () => {
  assert.deepEqual(OBSERVED_OPERATIONS, ["auth", "account", "community", "progression"]);
  assert.equal(outcomeFor(200), "success");
  assert.equal(outcomeFor(401), "unauthenticated");
  assert.equal(outcomeFor(409), "conflict");
  assert.equal(outcomeFor(429), "rate_limited");
  assert.equal(outcomeFor(503), "unavailable");
  assert.equal(outcomeFor(500), "server_error");
  assert.equal(outcomeFor(418), "client_error");
});

test("observed routes add correlation ids without changing status or body", async () => {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    const response = await withObservedRoute("account", new Request("http://local/api/v1/me"), async () =>
      Response.json({ ok: false }, { status: 503 }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false });
    assert.match(response.headers.get("x-correlation-id") ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    process.stdout.write = write;
  }
});
