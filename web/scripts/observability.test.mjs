import assert from "node:assert/strict";
import { test } from "node:test";

const { outcomeFor, redactSecrets, withObservedRoute, OBSERVED_OPERATIONS } = await import(
  "../lib/observability.ts"
);

test("redaction removes credentials, tokens, emails and database URLs", () => {
  const input = [
    "Cookie: session=abc",
    "Authorization: Bearer eyJabc.def.ghi",
    "password=hunter2",
    "ticket=eyJhbGciOi.signature.part",
    "EMAIL=reader@example.com",
    "DATABASE_URL=" + "postgres" + "ql://reader:secret@db.example.com/kaslyydex",
    "upstream_key=abcdef123456",
  ].join(" ");
  const redacted = redactSecrets(input);
  for (const secret of ["session=abc", "hunter2", "reader@example.com", "db.example.com", "abcdef123456"]) {
    assert.ok(!redacted.includes(secret), `${secret} leaked`);
  }
  assert.match(redacted, /\[redacted/);
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
