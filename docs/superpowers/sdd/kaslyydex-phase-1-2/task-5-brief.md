### Task 5: Next.js web migration and Rust WASM reader

## Execution constraints

- Owner paused Vercel/cloud deployment; complete local product/code/tests. No deployments, provisioning, pushes or merges. External integration gates remain pending.
- Do not regress redesigned Leptos UI capabilities: keep `/the-loai`, `/bxh`, `/tu-truyen`, search tag/status/sort/pagination, clickable story tags, persisted theme and guest data. Preserve existing public routes.
- Keep localStorage compatibility with both earlier camelCase Next entries and snake_case Leptos entries; normalize at the boundary and keep corrupt/unavailable storage non-fatal. New history carries page position, total pages and language; chapter-local page restoration only applies to the matching chapter.
- Use the existing design source `docs/design/DESIGN.md` and Leptos CSS as the visual reference (dark lime-accent shell/sidebar/real covers), not the older red legacy Next theme. Reader background settings remain independent of site theme.
- Rust reader state changes must call the actual loaded WASM methods; do not implement a JS shadow state machine while importing WASM as decoration. Catch WASM initialization/load errors visibly with retry, not a fake success fallback.
- Build wasm-bindgen artifacts through an explicit script, content-hash asset URLs where immutable caching is used, and document the command. Do not commit Rust `target/` or huge build output; CI rebuilds generated WASM from source before Next build.
- Next route files read installed docs under `web/node_modules/next/dist/docs/` first. Browser APIs/WASM only initialize on client.
- Native work remains deferred. No subagents. Implementation report `docs/superpowers/sdd/kaslyydex-phase-1-2/task-5-report.md` with tests, browser proof and known external gates.
- Important Task 4 review handoff: Axum `Md::pages()` still emits `/api/img?u=...`, while Next content proxy is `/api/content/*`. Ensure content pages + covers use Axum image endpoint, preserving legacy `/api/img` for the old Leptos app if still served. One solution: keep legacy endpoint as a forwarding compatibility alias and normalize new page URLs to `/api/content/img`; never leave a second MangaDex image fetcher in Next. Test actual bytes/content-type/cache headers through Next→Axum.
- Proxy hardening on this path: reject `.` and `..` segments before URL construction, keep host configured-only, no forwarded browser Cookie/Authorization/Set-Cookie. Test encoded/double-encoded traversal cases, empty pages, corrupt WASM and missing content configuration.

**Files:**
- Create: `crates/reader-wasm/Cargo.toml`, `crates/reader-wasm/src/lib.rs`
- Create: `web/components/reader/ReaderClient.tsx`, `ReaderToolbar.tsx`, `ReaderPages.tsx`
- Modify: `web/app/page.tsx`, `web/app/search/page.tsx`, `web/app/manga/[id]/page.tsx`, `web/app/read/[chapterId]/page.tsx`, `web/app/globals.css`
- Remove after parity: direct MangaDex calls in `web/lib/mangadex.ts` and duplicate `/api/pages` logic

**Interfaces:**
- WASM exposes reader-core state methods through wasm-bindgen.
- Next reader receives typed manga/chapter/pages DTOs and keeps browser-only behavior in Client Components.

- [ ] **Step 1: Write failing WASM tests/build checks** for exported initialization, page boundary and progress methods.
- [ ] **Step 2: Run `wasm-pack build crates/reader-wasm --target web` and Next typecheck; expected RED.
- [ ] **Step 3: Implement the wasm-bindgen adapter and client initialization only in a browser-safe Client Component.
- [ ] **Step 4: Port the redesigned UI routes from the existing Leptos/legacy Next behavior to Next Server Components while reading data from Axum.
- [ ] **Step 5: Preserve reader features: vertical/horizontal, swipe, progress, settings, external chapter link, retry, local guest history.
- [ ] **Step 6: Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, WASM build and Playwright smoke tests at 375px/desktop.
- [ ] **Step 7: Commit** `feat: migrate KasLyyDex web to Next and reader wasm`.

---

