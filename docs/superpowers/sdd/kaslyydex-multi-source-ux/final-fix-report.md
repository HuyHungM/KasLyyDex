# Final fix wave — multi-source UX

Base: `12e1a7dbe7f5367dcea7b17ffdf74adc529cad15` (branch `feature/kaslyydex-multi-source-ux`).
Final review: Ready-to-merge YES, 0 Critical/Important; three minors fixed below in one commit.
No subagents, cloud work, push, merge or deploy.

## Finding 1 — docs overclaimed broken-image retry (files: `README.md`, `docs/WEB-STATUS.md`)

Verified against `web/components/reader/ReaderPages.tsx`: both horizontal and vertical
`<img>` handlers only do `onError={(event) => event.currentTarget.setAttribute("data-loaded", "true")}`,
which releases the fade gate (broken image revealed, not a permanent skeleton). The retry panel
in `web/components/reader/ReaderClient.tsx` is gated by `showRetry = wasmError !== null || pageError !== null`
(lines 526, 581-598); it is a chapter/WASM page-load panel, not a per-image retry.
No UX was added. Reworded both docs to state the actual behavior and the existing panel's scope.

## Finding 2 — CDN comment claimed a verified delivery gate (`crates/core/src/comick.rs:9`)

Ledger/review recorded a live image fetch returning 403; the host `meo.comick.pictures` comes from
official spec examples, not a completed live delivery gate. Reworded comment to "CDN image host
listed in the official spec" plus "live delivery and ToS remain a manual release gate".
Existing image validation (`imgcache.rs`, `image_url()` host/scheme/port checks) unchanged.

## Finding 3 — Rust/TS opaque ID validation mismatch (`crates/core/src/comick.rs`)

TS `parseContentId` (`web/lib/validators.ts:158`) rejects `[\s\u0000-\u001f\u007f/?#]`, while Rust
`valid_opaque` accepted `/`, `?` and `#`. Aligned the Rust predicate with `matches!(c, '/' | '?' | '#')`
alongside the existing whitespace/control checks. TS untouched. `request_opaque` and `b2key`
validation inherit the stricter predicate; legitimate IDs such as `comick:abc123` are unaffected.

### RED first (test added before the predicate fix)

```
cd C:\Users\Hungg\.local\share\opencode\worktree\d7572a\kaslyydex-multi-source-ux
cargo test -p core comick
```

Result: 7 tests run, 6 passed, 1 FAILED. Failure:
`comick::tests::comick_id_rejects_path_delimiters_like_ts_parse_content_id` panicked at
`crates/core/src/comick.rs:258` with `accepted "comick:bad/id"`.
The new test asserts false for `comick:bad/id`, `comick:bad?id`, `comick:bad#id` and true for
`comick:abc123` (the existing test also kept `comick:abc123` true).

### GREEN after fix

```
cargo test -p core comick
```

Result: 7 passed, 0 failed, 0 ignored, 21 filtered out (includes both new and existing comick tests).

## Verification commands and exact counts

All commands run from the worktree root unless noted; counts are from the final run of each command.

| Command | Result |
| --- | --- |
| `cargo test -p core comick` | 7 passed, 0 failed, 21 filtered out |
| `cargo test -p core imgcache` | 5 passed, 0 failed, 23 filtered out (`allows_verified_comick_cdn_https`, `rejects_spoofed_comick_host_and_non_https`, `rejects_credentials_and_nonstandard_port`, `rejects_encoded_traversal_in_proxy_path`, `allows_only_https_image_origins`) |
| `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server -p core` | exit 0 (`FMT OK`) |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0, `Finished dev profile`, 0 warnings |
| `cargo build -p server` | exit 0, `Finished dev profile in 7.79s` (pretest binary for source fixtures) |
| `cd web && node --import tsx --conditions=react-server --test scripts/source-contracts.test.mjs scripts/source-progression.test.mjs scripts/source-fallback.test.mjs` | `tests 25`, `suites 0`, `pass 25`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`, `duration_ms 15968.0166` (repeat run: 25/25 pass, `16020.1664` ms) |

Web changes are documentation only, so `npm run typecheck` / `npm run lint` were not rerun
(as scoped for this wave). SDD scratch directory remains untracked; only the three tracked
files (`README.md`, `docs/WEB-STATUS.md`, `crates/core/src/comick.rs`) are committed.
