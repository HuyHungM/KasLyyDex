// Usage: node scripts/whitespace-check.mjs [repoDir]
// Inspects tracked files from the checkout/index, unlike `git diff --check`
// on a clean checkout. Reports file:line without printing file contents.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function scanText(text, file = "<text>") {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]+$/.test(lines[index])) {
      findings.push({ file, line: index + 1, rule: "trailing-whitespace" });
    }
    if (/^(<{7}|>{7})(?:\s|$)/.test(lines[index])) {
      findings.push({ file, line: index + 1, rule: "conflict-marker" });
    }
  }
  return findings;
}

export async function scanRepo(repoDir) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoDir, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(join(repoDir, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue; // binary
    findings.push(...scanText(text, file));
  }
  return { files: files.length, findings };
}

async function main(repoDir) {
  const { files, findings } = await scanRepo(resolve(repoDir));
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: ${finding.rule}`);
    }
    console.error(`whitespace check failed: ${findings.length} finding(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`whitespace check passed: ${files} tracked files inspected, 0 findings`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url)));
}
