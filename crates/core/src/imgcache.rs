use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Persistent cache dir (survives rebuilds): %LOCALAPPDATA%/TruyenViet/cache
pub fn cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CACHE_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(la).join("TruyenViet").join("cache");
    }
    PathBuf::from("cache")
}

fn allowed_host(host: &str) -> bool {
    host == "uploads.mangadex.org" || host.ends_with(".mangadex.network")
}

/// Decode repeatedly: b2key path segments are opaque and may still hide `%2f`,
/// `%2e%2e`, separators or control bytes that `Url` leaves percent-encoded.
fn safe_image_path(path: &str) -> bool {
    let mut decoded = path.to_owned();
    for _ in 0..3 {
        if decoded.contains("..")
            || decoded.contains('\\')
            || decoded.contains('?')
            || decoded.contains('#')
            || decoded.chars().any(|c| c.is_control())
        {
            return false;
        }
        let next = percent_decode_str(&decoded)
            .decode_utf8_lossy()
            .into_owned();
        if next.matches('/').count() != decoded.matches('/').count() {
            return false;
        }
        if next == decoded {
            return true;
        }
        decoded = next;
    }
    false
}

fn allowed(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && allowed_host(host)
        && safe_image_path(url.path())
}

/// `Url` normalizes encoded dot segments (`%2e%2e`) before `path()` is visible,
/// so reject those on the raw proxy input before parsing.
fn allowed_request(raw: &str) -> Option<reqwest::Url> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c") {
        return None;
    }
    reqwest::Url::parse(raw).ok().filter(allowed)
}

/// Download (once) into the disk cache and return the local path.
/// Slint then lazy-loads/decodes the file only when a delegate becomes visible.
pub async fn ensure(http: &reqwest::Client, url: &str) -> Result<PathBuf, String> {
    let parsed = allowed_request(url).ok_or_else(|| "Host not allowed".to_string())?;
    let ext = if parsed.path().ends_with(".png") {
        "png"
    } else {
        "jpg"
    };
    let key = format!("{:x}", Sha256::digest(url.as_bytes()));
    let path = cache_dir().join(format!("{key}.{ext}"));
    if path.exists() {
        return Ok(path);
    }
    let res = http.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Upstream {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(cache_dir())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_https_image_origins() {
        for raw in [
            "https://uploads.mangadex.org/covers/a/b.jpg.256.jpg",
            "https://example.mangadex.network/data/a/b.png",
        ] {
            assert!(allowed(&reqwest::Url::parse(raw).unwrap()), "{raw}");
        }
        for raw in [
            "http://uploads.mangadex.org/covers/a.jpg",
            "https://127.0.0.1/image.jpg",
            "https://uploads.mangadex.org.example.com/image.jpg",
            "https://uploads.mangadex.org:8080/image.jpg",
            "https://user:secret@uploads.mangadex.org/image.jpg",
        ] {
            assert!(!allowed(&reqwest::Url::parse(raw).unwrap()), "{raw}");
        }
    }

    #[test]
    fn rejects_non_allowlisted_hosts_and_non_https() {
        for raw in [
            "http://uploads.mangadex.org/a.jpg",
            "https://uploads.mangadex.org.example.com/a.jpg",
            "https://uploads.mangadex.org.evil.test/a.jpg",
            "https://evil.example/a.jpg",
            "https://127.0.0.1/a.jpg",
        ] {
            assert!(allowed_request(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn rejects_credentials_and_nonstandard_port() {
        for raw in [
            "https://user:secret@uploads.mangadex.org/a.jpg",
            "https://uploads.mangadex.org:8080/a.jpg",
        ] {
            assert!(allowed_request(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn rejects_encoded_traversal_in_proxy_path() {
        for raw in [
            "https://uploads.mangadex.org/%2e%2e/%2e%2e/etc/passwd",
            "https://uploads.mangadex.org/%2E%2E%2Fsecret.jpg",
            "https://uploads.mangadex.org/a%2fb.jpg",
            "https://uploads.mangadex.org/a%5cb.jpg",
            "https://uploads.mangadex.org/a%3Fb.jpg",
            "https://uploads.mangadex.org/a%23b.jpg",
            "https://uploads.mangadex.org/%252e%252e%252fsecret.jpg",
            "https://example.mangadex.network/%2e%2e/a.jpg",
        ] {
            assert!(allowed_request(raw).is_none(), "{raw}");
        }
    }
}
