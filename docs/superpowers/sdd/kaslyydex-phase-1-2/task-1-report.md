# Task 1 report: baseline rename and workspace boundaries

## Scope

- Moved the legacy Next.js app from `legacy-next/` to `web/` without changing
  its routes, components, data access, or reader behavior.
- Renamed user-facing product metadata and MangaDex user-agent strings to
  `KasLyyDex` / `KasLyyDexReader` in the root README, web metadata, the Rust
  server log, Rust UI metadata, and shared content clients.
- Kept Rust package names (`core`, `server`, `ui`) unchanged.
- Kept `crates/app` and `crates/ui` in place; explicitly excluded `crates/app`
  from the Cargo workspace while Android/GPUI work remains deferred.
- Added the variable-name-only `web/.env.example` and infrastructure boundary
  notes in `infra/README.md`.
- Updated `.gitignore` for the `web/` workspace while preserving the existing
  `.env*` protection and `.env.example` exception.

## Changed files

- `README.md`
- `Cargo.toml`
- `.gitignore`
- `crates/core/src/dns.rs`
- `crates/server/src/main.rs`
- `crates/ui/index.html`
- `crates/ui/src/views.rs`
- `web/` (moved from `legacy-next/`, retaining `AGENTS.md`, `README.md`,
  `app/api/{img/route.ts,pages/[chapterId]/route.ts}`, `app/{error.tsx,
  favicon.ico,globals.css,layout.tsx,manga/[id]/page.tsx,not-found.tsx,
  page.tsx,read/[chapterId]/page.tsx,search/page.tsx}`,
  `components/{chapter-list.tsx,continue-reading.tsx,header.tsx,
  manga-actions.tsx,manga-card.tsx,reader.tsx}`, `eslint.config.mjs`,
  `lib/{history.ts,http.ts,mangadex.ts,types.ts}`, `next-env.d.ts`,
  `next.config.ts`, `package{,-lock}.json`, `public/{file.svg,globe.svg,
  next.svg,vercel.svg,window.svg}`, and `tsconfig.json`)
- `web/.env.example`
- `infra/README.md`
- `docs/superpowers/sdd/kaslyydex-phase-1-2/task-1-report.md`

## RED evidence

Before implementation, the required repository check was run from the
worktree. It failed as expected with:

```text
FAIL: web/package.json is missing
FAIL: legacy-next/package.json still exists
FAIL: legacy product title remains in README.md
```

## GREEN evidence

After implementation, the repository check passed:

```text
PASS: product title, path, protected crate, and env ignore checks
```

The check confirmed `web/package.json` exists, `legacy-next/package.json` does
not, no old product title remains in root/web metadata, `crates/app` and
`crates/ui` remain present, and the environment-file rules are correct.

## Verification

- `npm install` from `web/`: passed; 360 packages audited, 0 vulnerabilities.
- `npm run build` from `web/`: passed with Next.js 16.4.6.
- Focused ESLint on the changed web source files: passed.
- `cargo test --workspace`: passed; 20 tests passed, 0 failed.
- `git diff --check`: passed.

## Concerns / known baseline issues

- Full `npm run lint` still reports four existing `react-hooks/set-state-in-effect`
  errors in untouched files: `web/components/chapter-list.tsx`,
  `continue-reading.tsx`, `manga-actions.tsx`, and `reader.tsx`. They are not
  caused by this metadata/path-only task and were not changed.
- `cargo +stable-x86_64-pc-windows-msvc fmt --check` reports pre-existing
  formatting differences across the Rust workspace, including unrelated lines
  in files touched only for product strings. Formatting was not broadened into
  this task; the workspace tests remain green.
- The legacy `TruyenViet` cache directory and `truyenviet:*` browser storage
  keys were intentionally preserved to avoid changing reader/cache behavior.
- No credentials, `.env` files, or external Vercel/Neon resources were added.
