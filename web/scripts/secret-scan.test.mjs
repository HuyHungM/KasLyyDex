import assert from "node:assert/strict";
import { test } from "node:test";
import { scanText } from "./secret-scan-lib.mjs";

test("secret scan detects provider credentials and non-empty secret assignments", () => {
  const key = "sk-" + "a".repeat(30);
  const url = "postgres" + "ql://reader:hunter2@db.example.com/kaslyydex";
  const findings = scanText(
    ["api_key_value = '" + key + "'", "DATABASE_URL=" + url, "READER_TICKET_SECRET="].join("\n"),
  );
  assert.deepEqual(
    findings.map((finding) => finding.pattern).sort(),
    ["database-url-with-password", "non-empty-secret-assignment", "openai-key"],
  );
  assert.equal(findings.find((f) => f.pattern === "database-url-with-password").line, 2);
});

test("secret scan ignores blank example values and ordinary source lines", () => {
  const findings = scanText(
    [
      "DATABASE_URL=",
      "READER_TICKET_SECRET=",
      "process.env.NEON_AUTH_COOKIE_SECRET = fixtureValue;",
      "const label = 'public health returns ok';",
    ].join("\n"),
  );
  assert.deepEqual(findings, []);
});
