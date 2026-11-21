// Usage: node scripts/whitespace-check.mjs [--baseline <file>] [repoDir]
// Inspects tracked files from the checkout/index, unlike `git diff --check`
// on a clean checkout. Reports file:line without printing file contents.
// With --baseline, findings listed in the baseline file (`file:line:rule`
// per line, `#` comments allowed) are pre-existing and do not fail the gate;
// any new finding still fails.
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

export function findingKey(finding) {
  return `${finding.file}:${finding.line}:${finding.rule}`;
}

export async function loadBaseline(baselineFile) {
  const text = await readFile(baselineFile, "utf8");
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
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

async function main(baselineFile, repoDir) {
  const { files, findings } = await scanRepo(resolve(repoDir));
  const baseline = baselineFile ? await loadBaseline(baselineFile) : new Set();
  const fresh = findings.filter((finding) => !baseline.has(findingKey(finding)));
  const known = findings.length - fresh.length;
  if (fresh.length > 0) {
    for (const finding of fresh) {
      console.error(`${finding.file}:${finding.line}: ${finding.rule}`);
    }
    console.error(`whitespace check failed: ${fresh.length} new finding(s), ${known} baselined`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `whitespace check passed: ${files} tracked files inspected, ` +
      (known > 0 ? `0 new findings (${known} baselined)` : "0 findings"),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let baselineFile;
  if (args[0] === "--baseline") {
    baselineFile = args[1];
    args.splice(0, 2);
    if (!baselineFile) throw new Error("--baseline requires a file path");
  }
  await main(baselineFile, args[0] ?? fileURLToPath(new URL("../..", import.meta.url)));
}
