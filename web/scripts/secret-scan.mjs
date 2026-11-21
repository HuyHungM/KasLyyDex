// Usage: node scripts/secret-scan.mjs [repoDir]
// Scans tracked text files only; values are never printed.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanText } from "./secret-scan-lib.mjs";

const repoDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url)));
const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoDir, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => /\.(?:md|mjs|js|ts|tsx|json|yml|yaml|sql|toml|example|txt)$/.test(file) || file.endsWith(".env.example"));

const findings = [];
for (const file of files) {
  let text;
  try {
    text = await readFile(join(repoDir, file), "utf8");
  } catch {
    continue;
  }
  findings.push(...scanText(text, file));
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.pattern}`);
  }
  console.error(`secret scan failed: ${findings.length} candidate(s)`);
  process.exit(1);
}
console.log(`secret scan passed: ${files.length} tracked text files, 0 candidates`);
