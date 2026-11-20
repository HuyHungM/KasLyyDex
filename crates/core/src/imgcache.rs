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

fn allowed(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && (host == "uploads.mangadex.org" || host.ends_with(".mangadex.network"))
}

/// Download (once) into the disk cache and return the local path.
/// Slint then lazy-loads/decodes the file only when a delegate becomes visible.
pub async fn ensure(http: &reqwest::Client, url: &str) -> Result<PathBuf, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Bad url".to_string())?;
    if !allowed(&parsed) {
        return Err("Host not allowed".into());
    }
    let ext = if parsed.path().ends_with(".png") { "png" } else { "jpg" };
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
    tokio::fs::create_dir_all(cache_dir()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &bytes).await.map_err(|e| e.to_string())?;
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
}
