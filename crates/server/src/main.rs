use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use manga_core::Md;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

type Err = (StatusCode, String);

fn json_cached(v: Arc<Value>, secs: u32) -> Response {
    let mut res = Json(v).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_str(&format!("public, max-age={secs}")).unwrap(),
    );
    res
}

async fn popular(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.popular().await.map_err(bad)?, 60))
}

async fn latest(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.latest().await.map_err(bad)?, 60))
}

async fn search(State(md): State<Md>, Query(q): Query<HashMap<String, String>>) -> Result<Response, Err> {
    let q = parse_search_query(q)?;
    Ok(json_cached(md.search_filtered(&q.q, q.page, &q.tags, q.status.as_deref(), &q.sort).await.map_err(bad)?, 60))
}

#[derive(Debug)]
struct SearchQuery {
    q: String,
    page: u32,
    tags: Vec<String>,
    status: Option<String>,
    sort: String,
}

fn parse_search_query(q: HashMap<String, String>) -> Result<SearchQuery, Err> {
    let value = |key| q.get(key).map(|s| s.trim()).filter(|s| !s.is_empty());
    let invalid = |name| (StatusCode::BAD_REQUEST, format!("{name} không hợp lệ."));
    let page = match value("page") {
        Some(raw) => raw.parse::<u32>().ok().filter(|p| (1..=416).contains(p)).ok_or_else(|| invalid("Số trang"))?,
        None => 1,
    };
    let query = value("q").unwrap_or("");
    if query.chars().count() > 200 {
        return Err(invalid("Tên truyện"));
    }
    let sort = value("sort").unwrap_or("follows");
    manga_core::mangadex::sort_param(sort).ok_or_else(|| invalid("Cách sắp xếp"))?;
    let status = value("status");
    if status.is_some_and(|s| manga_core::mangadex::status_param(s).is_none()) {
        return Err(invalid("Trạng thái"));
    }
    let mut tags: Vec<_> = value("tags").into_iter().flat_map(|s| s.split(',')).collect();
    if tags.len() > 8 || !tags.iter().all(|id| is_uuid(id)) {
        return Err(invalid("Thể loại"));
    }
    tags.sort_unstable();
    tags.dedup();
    Ok(SearchQuery { q: query.to_owned(), page, tags: tags.into_iter().map(str::to_ascii_lowercase).collect(),
        status: status.map(str::to_owned), sort: sort.to_owned() })
}

fn is_uuid(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => b == b'-',
        _ => b.is_ascii_hexdigit(),
    })
}

async fn tags(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.tags().await.map_err(bad)?, 86_400))
}

async fn rank(State(md): State<Md>, Query(q): Query<HashMap<String, String>>) -> Result<Response, Err> {
    let kind = q.get("kind").map(String::as_str).unwrap_or("follows");
    if !matches!(kind, "follows" | "rating") {
        return Err((StatusCode::BAD_REQUEST, "Kiểu xếp hạng không hợp lệ.".into()));
    }
    Ok(json_cached(md.rank(kind).await.map_err(bad)?, 300))
}

async fn manga(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err((StatusCode::BAD_REQUEST, "Mã truyện không hợp lệ.".into()));
    }
    Ok(json_cached(md.manga(&id).await.map_err(bad)?, 3600))
}

async fn chapters(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err((StatusCode::BAD_REQUEST, "Mã truyện không hợp lệ.".into()));
    }
    Ok(json_cached(md.chapters(&id).await.map_err(bad)?, 60))
}

async fn pages(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err((StatusCode::BAD_REQUEST, "Mã chương không hợp lệ.".into()));
    }
    Ok(json_cached(Arc::new(md.pages(&id).await.map_err(bad)?), 120))
}

/// Same-origin image proxy: disk-cached, host allowlist enforced in core.
async fn img(State(md): State<Md>, Query(q): Query<HashMap<String, String>>) -> Result<Response, Err> {
    let raw = q.get("u").cloned().unwrap_or_default();
    let path = manga_core::imgcache::ensure(&md.http, &raw).await.map_err(bad)?;
    let ctype = if path.extension().map(|e| e == "png").unwrap_or(false) {
        "image/png"
    } else {
        "image/jpeg"
    };
    let bytes = tokio::fs::read(&path).await.map_err(|e| bad(e.to_string()))?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(ctype)),
            (header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable")),
        ],
        Body::from(bytes),
    )
        .into_response())
}

fn bad(e: String) -> Err {
    (StatusCode::BAD_GATEWAY, e)
}

/// Hashed static assets are immutable; HTML and API stay revalidatable.
fn static_cache_control(_path: &str, status: StatusCode, content_type: &str) -> &'static str {
    if status.is_success() && !content_type.starts_with("text/html") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

async fn static_cache_headers(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let path = req.uri().path().to_string();
    let mut res = next.run(req).await;
    if !path.starts_with("/api") {
        let content_type = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
        let policy = static_cache_control(&path, res.status(), content_type);
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(policy),
        );
    }
    res
}

#[tokio::main]
async fn main() {
    let md = Md::new(manga_core::dns::PublicDns::client());
    let dist = std::env::var("DIST_DIR").unwrap_or_else(|_| "crates/ui/dist".into());
    let spa = ServeDir::new(&dist).fallback(ServeFile::new(format!("{dist}/index.html")));

    let app = Router::new()
        .route("/api/popular", get(popular))
        .route("/api/latest", get(latest))
        .route("/api/search", get(search))
        .route("/api/tags", get(tags))
        .route("/api/rank", get(rank))
        .route("/api/manga/{id}", get(manga))
        .route("/api/manga/{id}/chapters", get(chapters))
        .route("/api/chapter/{id}/pages", get(pages))
        .route("/api/img", get(img))
        .fallback_service(spa)
        .layer(axum::middleware::from_fn(static_cache_headers))
        .layer(CompressionLayer::new())
        .with_state(md);

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3100);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    println!("TruyệnViệt (Rust/Leptos) listening on http://localhost:{port}");
    axum::serve(listener, app).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_rejects_invalid_filters_and_bounds_pagination() {
        for (name, value) in [("sort", "bad"), ("status", "bad"), ("tags", "bad"), ("page", "4294967295")] {
            assert_eq!(parse_search_query(HashMap::from([(name.into(), value.into())])).unwrap_err().0, StatusCode::BAD_REQUEST);
        }
        let id = "391b0423-d847-456f-aff0-8b0cfc03066b";
        assert_eq!(parse_search_query(HashMap::from([("tags".into(), vec![id; 9].join(","))])).unwrap_err().0, StatusCode::BAD_REQUEST);
        let query = parse_search_query(HashMap::from([("tags".into(), id.into()), ("sort".into(), "rating".into())])).unwrap();
        assert_eq!(query.tags, [id]);
        assert_eq!(query.sort, "rating");
        assert!(query.q.is_empty());
    }

    #[test]
    fn spa_routes_and_errors_must_revalidate() {
        for path in ["/", "/index.html", "/search", "/manga/abc", "/read/abc"] {
            assert_eq!(static_cache_control(path, StatusCode::OK, "text/html"), "no-cache", "{path}");
        }
        assert_eq!(static_cache_control("/ui-deadbeef.wasm", StatusCode::NOT_FOUND, "text/plain"), "no-cache");
    }

    #[test]
    fn successful_hashed_assets_are_immutable() {
        assert_eq!(
            static_cache_control("/ui-deadbeef_bg.wasm", StatusCode::OK, "application/wasm"),
            "public, max-age=31536000, immutable"
        );
    }
}
