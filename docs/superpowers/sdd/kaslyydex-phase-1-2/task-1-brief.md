### Task 1: Baseline rename and workspace boundaries

**Files:**
- Modify: `README.md`, `Cargo.toml`, `.gitignore`
- Move: `legacy-next/` → `web/`
- Create: `web/.env.example`, `infra/README.md`
- Modify: `crates/core`, `crates/server`, `crates/ui` product strings only

**Interfaces:**
- Produces the stable project layout consumed by Tasks 2–10.

- [ ] **Step 1: Write the failing repository checks**: a shell check must find no user-facing `TruyệnViệt` product title in the root/web metadata except migration notes, and `web/package.json` must exist while `legacy-next/package.json` must not.
- [ ] **Step 2: Run the check** and record RED against the current layout.
- [ ] **Step 3: Move/rename the web app and update product metadata** to `KasLyyDex`; do not alter behavior or UI in this task.
- [ ] **Step 4: Add `.env.example` with variable names only**: `NEXT_PUBLIC_APP_URL`, `RUST_CONTENT_API_ORIGIN`. Neon/Auth values are added in Task 4, after the Vercel skeleton is deployed.
- [ ] **Step 5: Run `npm install`/`npm run build` from `web/` and `cargo test --workspace`; expected: existing behavior still builds.
- [ ] **Step 6: Commit** `chore: establish KasLyyDex web workspace`.

### Preflight ruling carried from the ledger

Change user-visible branding and product metadata only (title, description, logo text, user-agent, readme); preserve layout/behavior. Historical migration/spec notes may retain the old product name. Do not rename Rust crate/package identifiers in this task.

### Workspace constraints

- Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`.
- Never commit `.env` or credentials. `.env.example` contains names/placeholders only.
- Do not deploy or create external Vercel/Neon resources in Task 1.
- Do not dispatch another subagent.
- Run tests, self-review, commit with the specified subject, and write full report to `docs/superpowers/sdd/kaslyydex-phase-1-2/task-1-report.md`.
