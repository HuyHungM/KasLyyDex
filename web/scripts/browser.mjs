import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const LOCAL_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

/// Prefer an explicit operator override, then the installed Windows Edge used
/// for local verification, then Playwright's installed Chromium in CI.
export function browserExecutable() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (override) {
    if (!existsSync(override)) throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE not found: ${override}`);
    return override;
  }
  if (existsSync(LOCAL_EDGE)) return LOCAL_EDGE;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  throw new Error(
    "No browser found. Run `node node_modules/playwright-core/cli.js install chromium` " +
    "or set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chromium/Edge binary.",
  );
}
