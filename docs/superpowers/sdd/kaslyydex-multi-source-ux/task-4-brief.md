### Task 4: Per-source image proxy allowlist

**Files:**
- Modify: `crates/core/src/imgcache.rs`
- Test: `crates/core/src/imgcache.rs` inline tests

**Interfaces:**
- Consumes: Comick page URLs from Task 2/3.
- Produces: `fn allowed(url: &reqwest::Url) -> bool` extended with verified Comick CDN hosts while preserving MangaDex rules.
- Produces: test-visible helper `fn allowed_host(host: &str) -> bool` if useful.

- [ ] **Step 1: Write failing allowlist tests**

Add tests:
- `allows_verified_comick_cdn_https`
- `rejects_spoofed_comick_host_and_non_https`
- `rejects_credentials_and_nonstandard_port`

Use the exact Comick CDN host verified in Task 2. If Task 2 verified `meo.comick.pictures`, assert that host is allowed over HTTPS and these are rejected:
- `http://meo.comick.pictures/a.jpg`
- `https://meo.comick.pictures.example.com/a.jpg`
- `https://user:secret@meo.comick.pictures/a.jpg`
- `https://meo.comick.pictures:8080/a.jpg`

- [ ] **Step 2: Run tests to verify RED**

Run: `cargo test -p core imgcache`
Expected: FAIL for Comick host allowance.

- [ ] **Step 3: Extend allowlist minimally**

Add only the verified Comick CDN host(s). Keep HTTPS, port 443, no userinfo, and exact/suffix rules safe. Do not allow arbitrary hosts.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `cargo test -p core imgcache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/imgcache.rs
git commit -m "feat: allow verified Comick CDN through image proxy"
```
