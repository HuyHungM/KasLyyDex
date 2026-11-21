// Deterministic, secret-free credential pattern scan. It looks for provider
// credentials and non-empty secret assignments; fixture values are built at
// runtime in tests and never appear literally in tracked files.
export const PATTERNS = [
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "google-api-key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{36}/ },
  { name: "openai-key", re: /sk-[A-Za-z0-9_-]{24,}/ },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "database-url-with-password", re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i },
  {
    name: "non-empty-secret-assignment",
    re: /^[ \t]*(?:NEON_AUTH_COOKIE_SECRET|READER_TICKET_SECRET|DATABASE_URL|GOOGLE_CLIENT_SECRET|NEON_AUTH_BASE_URL)[ \t]*=[ \t]*\S.*$/m,
  },
];

export function scanText(text, file = "<text>") {
  const findings = [];
  for (const { name, re } of PATTERNS) {
    const match = text.match(re);
    if (match) findings.push({ file, pattern: name, line: text.slice(0, match.index).split("\n").length });
  }
  return findings;
}
