# Task 4 — Per-source image proxy allowlist

Status: DONE. Commit: `4ae012d` (`feat: allow verified Comick CDN through image proxy`), branch `feature/kaslyydex-multi-source-ux`, base `445d8eca5215608dd89329c8b09479ee7d49db52`.

Only `crates/core/src/imgcache.rs` was committed. The SDD directory (incl. this report) remains untracked.

## Change

- `allowed_host(host)` now accepts exactly `meo.comick.pictures` in addition to the unchanged MangaDex rules (`uploads.mangadex.org` exact, `.mangadex.network` suffix).
- `allowed(url)` still requires HTTPS, known/default port 443, empty userinfo, and now also calls `safe_image_path(url.path())`.
- `safe_image_path` percent-decodes up to 3 passes and rejects `..`, `\`, `?`, `#`, control bytes, and any decode that changes the number of `/` separators (catches `%2f`, `%5c`, `%3f`, `%23`, double-encoded forms).
- `allowed_request(raw)` rejects raw `%2e`/`%2f`/`%5c` (case-insensitive) before `Url::parse`, because `url` normalizes encoded dot segments away before `path()` is observable. `ensure()` now goes through this single gate before any cache lookup or fetch.
- No new dependency: `percent-encoding = "2"` was already a direct dependency of `core`.

## RED — tests first

Command: `cargo test -p core imgcache`

Result: 5 tests run; 3 passed, 2 failed, 0 ignored, 22 filtered out; exit 1.

Failures:
- `imgcache::tests::allows_verified_comick_cdn_https` — `https://meo.comick.pictures/a.jpg` rejected.
- `imgcache::tests::rejects_encoded_traversal_in_proxy_path` — `https://uploads.mangadex.org/%2e%2e/a.jpg` accepted. (The Comick encoded cases in that test initially "passed" only because the host was not yet allowed; they became meaningful after the allowlist change.)

## GREEN — after implementation

Command: `cargo test -p core imgcache`

Result: 5 passed, 0 failed, 0 ignored, 22 filtered out; exit 0.
Named tests all present: `allows_verified_comick_cdn_https`, `rejects_spoofed_comick_host_and_non_https`, `rejects_credentials_and_nonstandard_port`, plus `rejects_encoded_traversal_in_proxy_path` and the unchanged `allows_only_https_image_origins`.

Rejected cases proven (exact host, no look-alikes, no arbitrary hosts, no credentials, no non-443 port, no encoded traversal):
`http://meo.comick.pictures/a.jpg`, `https://meo.comick.pictures.example.com/a.jpg`, `https://meo.comick.pictures.evil.test/a.jpg`, `https://evil.example/a.jpg`, `https://127.0.0.1/a.jpg`, `https://meo-comick-pictures.xyz/a.jpg`, `https://user:secret@meo.comick.pictures/a.jpg`, `https://meo.comick.pictures:8080/a.jpg`, `%2e%2e` / `%2E%2E%2F` / `a%2fb` / `a%5cb` / `a%3Fb` / `a%23b` / `%252e%252e%252f` paths, and the MangaDex `%2e%2e` path.

## Other verification

- `cargo test -p core` — 27 passed, 0 failed; doc-tests 0 passed; exit 0.
- `cargo clippy -p core --all-targets -- -D warnings` — exit 0. First run flagged one `redundant_closure` in `allowed_request`; fixed to `.filter(allowed)` and re-ran clean.
- `rustfmt --edition 2021 crates/core/src/imgcache.rs` — applied (task file is rustfmt-clean).
- `cargo fmt -p core -- --check` — still reports 2 pre-existing diffs in `crates/core/src/comick.rs` (lines 119 and 159, Task 2/3 code, out of Task 4 scope). No imgcache.rs diffs.
- `cargo check --workspace` — exit 0.

## Concerns / limits

1. The raw gate rejects any `%2e`, `%2f`, or `%5c` anywhere in the input string, including query/fragment. This is deliberately conservative; no current Task 2/3 generated URL uses those sequences, but a future legitimately encoded filename could be rejected.
2. Path checks are stricter than before for MangaDex URLs too (strengthening, not weakening); no observed MangaDex URL contains `..`, `\`, `?`, `#`, or extra separators.
3. `Url` normalizes both literal `..` segments and encoded dot segments before `path()` is readable, so encoded-dot detection only exists on the raw string. All proxy calls reach `ensure()` (`crates/server/src/main.rs:457`); a future caller that calls `allowed()` with an already-parsed URL would bypass the raw gate (though `%2f` decode checks in `safe_image_path` would still apply).
4. Task 2 reviewer handoff item is only partly addressed: raw `?`, `#`, and `\` in `b2key` remain accepted by `comick.rs::image_url` (out of Task 4's file scope). They do not escape the exact CDN host, but `comick.rs` should still tighten `b2key` validation separately.
5. Explicit `:443` is accepted (`port_or_known_default() == Some(443)`), consistent with "HTTPS port 443 only"; `8080` and other ports are rejected.
6. No live network fetch was exercised — verification is unit-level on the allowlist gate; no auth/db/deploy/push/merge was performed.

Skipped: live upstream fetch test; touching `comick.rs` b2key validation (Task 2 scope).
Risk: conservative raw encoding rejection may block a future legitimately encoded image path; no current generated URL is affected.
