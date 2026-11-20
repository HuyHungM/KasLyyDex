# SDD ledger — plan: docs/superpowers/plans/2026-11-20-truyenviet-redesign.md

Workspace: `docs/superpowers/sdd/truyenviet-redesign/` (manual: this repo is NOT a git repo, `sdd-workspace` script cannot run).
No git commits: plan's Commit steps are replaced by ticking task checkboxes.
The user requested continuing with the current model. Tasks 1–9 were verified and integrated in this session after the initial subagent stopped.

## Preflight conflict scan (plan vs plan / spec)

| Tasks | Shared file / interface | Finding | Ruling |
|---|---|---|---|
| 1 ↔ 5,6,8 | `api.rs` types | Task 5 needs `rating`/`follows` on `MangaCard` and a `chapters` array from `/api/latest`, but Task 1's interface list doesn't add those fields. | Ruling: Task 1 adds `#[serde(default)] rating: Option<f64>` and `follows: Option<u64>` to `MangaSummary`; Task 5 defines a local `LatestManga` with flattened `MangaSummary` + `chapters: Vec<LatestChapter>`. Cost if wrong: one extra field edit in Task 1. |
| 4 ↔ 5,6,7,8 | `style.css` | Task 4 rewrites the whole stylesheet, but later tasks introduce new components with no CSS task assigned. | Ruling: Task 4 owns tokens/base/layout only; each later task appends its own component section to `style.css` using Task 4's tokens. Cost if wrong: minor CSS cleanup. |
| 4 ↔ 7,8 | `BottomTabs` red dot | Task 7 needs to set the library-update dot but no signal is defined in Task 4. | Ruling: Task 4 exposes `pub LIBRARY_UPDATES: RwSignal<bool>` (module-level in `views.rs`); Task 7 sets it. Cost if wrong: small shared-state wiring fix. |
| 2 ↔ 3 | `/api/latest` shape | Core enriches summaries with `chapters`; server must pass through unchanged. | No conflict: server handler serializes the `Value` from core directly. |
| 5 ↔ 9 | `MangaCard` | Task 5 produces it, Task 9's manga page doesn't consume it (only list rows). | No conflict. |

## Task status

- [x] Task 1: Pure UI helpers with tests
- [x] Task 2: Core client — filters, statistics, tags, rankings, richer feed
- [x] Task 3: Server routes and validation
- [x] Task 4: Design system, theme, app shell
- [x] Task 5: Home feed redesign
- [x] Task 6: Search filters, genres, rankings pages
- [x] Task 7: Bookshelf and follow flow
- [x] Task 8: Professional reader
- [x] Task 9: Manga detail, integration and documentation

## Integration decisions

- The workspace package is named `core`. `manga_core` is the dependency alias in `crates/server/Cargo.toml`.
- The library notification signal is scoped to the Leptos router context. Opening the home page checks the recent feed. Opening the bookshelf checks the full saved list, using up to four requests at once.
- A followed manga gets a new-chapter badge for a readable release after the follow or latest reading date in the followed language. A reload preserves the history of older library entries through serde defaults.
- The recent-ranking tab reuses the live feed, which can contain fewer than 24 titles. The other two rankings request up to 24 titles.
- Optional ratings and latest-chapter labels are displayed only when upstream metadata is available. The app can show results when a supplemental upstream request fails.
- The release WASM exceeds the raw size target. Transfer size with Brotli and build verification are recorded in `docs/WEB-STATUS.md`.
