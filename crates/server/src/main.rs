use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use contracts::{ApiError, ApiErrorEnvelope};
use manga_core::mangadex::is_uuid;
use manga_core::Md;
use serde::Serialize;
use std::collections::HashMap;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

type Err = (StatusCode, Json<ApiErrorEnvelope>);

fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> Err {
    (
        status,
        Json(ApiErrorEnvelope {
            error: ApiError::new(code, message),
        }),
    )
}

fn json_cached<T: Serialize>(v: T, secs: u32) -> Response {
    let mut res = Json(v).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_str(&format!("public, max-age={secs}")).unwrap(),
    );
    res
}

fn json_no_store<T: Serialize>(v: T) -> Response {
    let mut res = Json(v).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    res
}

async fn popular(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.popular().await.map_err(bad)?, 60))
}

async fn latest(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.latest().await.map_err(bad)?, 60))
}

async fn search(
    State(md): State<Md>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, Err> {
    let q = parse_search_query(q)?;
    Ok(json_cached(
        md.search_filtered(&q.q, q.page, &q.tags, q.status.as_deref(), &q.sort)
            .await
            .map_err(bad)?,
        60,
    ))
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
    let invalid = |name| {
        api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            format!("{name} không hợp lệ."),
        )
    };
    let page = match value("page") {
        Some(raw) => raw
            .parse::<u32>()
            .ok()
            .filter(|p| (1..=416).contains(p))
            .ok_or_else(|| invalid("Số trang"))?,
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
    let mut tags: Vec<_> = value("tags")
        .into_iter()
        .flat_map(|s| s.split(','))
        .collect();
    if tags.len() > 8 || !tags.iter().all(|id| is_uuid(id)) {
        return Err(invalid("Thể loại"));
    }
    tags.sort_unstable();
    tags.dedup();
    Ok(SearchQuery {
        q: query.to_owned(),
        page,
        tags: tags.into_iter().map(str::to_ascii_lowercase).collect(),
        status: status.map(str::to_owned),
        sort: sort.to_owned(),
    })
}

#[derive(Debug)]
struct NotificationFeedQuery {
    lang: String,
    since: Option<String>,
    offset: u32,
    limit: u32,
}

fn parse_notification_feed_query(q: HashMap<String, String>) -> Result<NotificationFeedQuery, Err> {
    let invalid = || {
        api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Tham số feed thông báo không hợp lệ.",
        )
    };
    let lang = q.get("lang").map(String::as_str).unwrap_or("vi");
    if !matches!(lang, "vi" | "en") {
        return Err(invalid());
    }
    let limit = q
        .get("limit")
        .map(|raw| raw.parse::<u32>().ok())
        .unwrap_or(Some(500))
        .filter(|value| *value >= 1 && *value <= 500)
        .ok_or_else(invalid)?;
    let offset = q
        .get("offset")
        .map(|raw| raw.parse::<u32>().ok())
        .unwrap_or(Some(0))
        .filter(|value| value.saturating_add(limit) <= 10_000)
        .ok_or_else(invalid)?;
    let since = match q.get("since").map(|value| value.trim()) {
        None | Some("") => None,
        Some(raw) => {
            let value = raw.to_owned();
            if value.len() > 30
                || !value
                    .chars()
                    .all(|c| c.is_ascii_digit() || "-:.TZ".contains(c))
            {
                return Err(invalid());
            }
            Some(value)
        }
    };
    Ok(NotificationFeedQuery {
        lang: lang.to_owned(),
        since,
        offset,
        limit,
    })
}

async fn tags(State(md): State<Md>) -> Result<Response, Err> {
    Ok(json_cached(md.tags().await.map_err(bad)?, 86_400))
}

async fn rank(
    State(md): State<Md>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, Err> {
    let kind = q.get("kind").map(String::as_str).unwrap_or("follows");
    if !matches!(kind, "follows" | "rating") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Kiểu xếp hạng không hợp lệ.",
        ));
    }
    Ok(json_cached(md.rank(kind).await.map_err(bad)?, 300))
}

async fn manga(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Mã truyện không hợp lệ.",
        ));
    }
    Ok(json_cached(md.manga(&id).await.map_err(bad)?, 3600))
}

async fn chapters(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Mã truyện không hợp lệ.",
        ));
    }
    Ok(json_cached(md.chapters(&id).await.map_err(bad)?, 60))
}

async fn notification_feed(
    State(md): State<Md>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Mã truyện không hợp lệ.",
        ));
    }
    let query = parse_notification_feed_query(q)?;
    let page = md
        .notification_feed(
            &id,
            &query.lang,
            query.since.as_deref(),
            query.offset,
            query.limit,
        )
        .await
        .map_err(bad)?;
    Ok(json_no_store(page))
}

async fn pages(State(md): State<Md>, Path(id): Path<String>) -> Result<Response, Err> {
    if !is_uuid(&id) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Mã chương không hợp lệ.",
        ));
    }
    Ok(json_cached(md.pages(&id).await.map_err(bad)?, 120))
}

/// Same-origin image proxy: disk-cached, host allowlist enforced in core.
async fn img(
    State(md): State<Md>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, Err> {
    let raw = q.get("u").cloned().unwrap_or_default();
    let path = manga_core::imgcache::ensure(&md.http, &raw)
        .await
        .map_err(bad)?;
    let ctype = if path.extension().map(|e| e == "png").unwrap_or(false) {
        "image/png"
    } else {
        "image/jpeg"
    };
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| bad(e.to_string()))?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(ctype)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            ),
        ],
        Body::from(bytes),
    )
        .into_response())
}

fn bad(e: String) -> Err {
    api_error(StatusCode::BAD_GATEWAY, "UPSTREAM_ERROR", e)
}

/// Hashed static assets are immutable; HTML and API stay revalidatable.
fn static_cache_control(_path: &str, status: StatusCode, content_type: &str) -> &'static str {
    if status.is_success() && !content_type.starts_with("text/html") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

async fn static_cache_headers(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = req.uri().path().to_string();
    let mut res = next.run(req).await;
    if !path.starts_with("/api") {
        let content_type = res
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let policy = static_cache_control(&path, res.status(), content_type);
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    }
    res
}

/// Browser-facing content namespace. Legacy /api/* paths remain registered
/// below for existing native/UI clients; both share these handlers and state.
fn content_routes() -> Router<Md> {
    Router::new()
        .route("/api/content/popular", get(popular))
        .route("/api/content/latest", get(latest))
        .route("/api/content/search", get(search))
        .route("/api/content/tags", get(tags))
        .route("/api/content/rank", get(rank))
        .route("/api/content/manga/{id}", get(manga))
        .route("/api/content/manga/{id}/chapters", get(chapters))
        .route(
            "/api/content/notifications/feed/{id}",
            get(notification_feed),
        )
        .route("/api/content/chapter/{id}/pages", get(pages))
        .route("/api/content/img", get(img))
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
        .merge(content_routes())
        .fallback_service(spa)
        .layer(axum::middleware::from_fn(static_cache_headers))
        .layer(CompressionLayer::new())
        .with_state(md);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3100);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind");
    println!("KasLyyDex (Rust/Leptos) listening on http://localhost:{port}");
    axum::serve(listener, app).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_rejects_invalid_filters_and_bounds_pagination() {
        for (name, value) in [
            ("sort", "bad"),
            ("status", "bad"),
            ("tags", "bad"),
            ("page", "4294967295"),
        ] {
            assert_eq!(
                parse_search_query(HashMap::from([(name.into(), value.into())]))
                    .unwrap_err()
                    .0,
                StatusCode::BAD_REQUEST
            );
        }
        let id = "391b0423-d847-456f-aff0-8b0cfc03066b";
        assert_eq!(
            parse_search_query(HashMap::from([("tags".into(), [id; 9].join(","))]))
                .unwrap_err()
                .0,
            StatusCode::BAD_REQUEST
        );
        let query = parse_search_query(HashMap::from([
            ("tags".into(), id.into()),
            ("sort".into(), "rating".into()),
        ]))
        .unwrap();
        assert_eq!(query.tags, [id]);
        assert_eq!(query.sort, "rating");
        assert!(query.q.is_empty());
    }

    #[test]
    fn notification_feed_query_bounds_language_limit_offset_and_since() {
        let parsed = parse_notification_feed_query(HashMap::from([
            ("lang".into(), "vi".into()),
            ("limit".into(), "100".into()),
            ("offset".into(), "300".into()),
            ("since".into(), "2026-07-01T00:00:00Z".into()),
        ]))
        .unwrap();
        assert_eq!(parsed.lang, "vi");
        assert_eq!(parsed.limit, 100);
        assert_eq!(parsed.offset, 300);
        assert_eq!(parsed.since.as_deref(), Some("2026-07-01T00:00:00Z"));

        for (name, value) in [
            ("lang", "fr"),
            ("limit", "0"),
            ("limit", "501"),
            ("offset", "9901"),
            ("since", "2026-07-01T00:00:00Z; DROP TABLE x"),
        ] {
            assert_eq!(
                parse_notification_feed_query(HashMap::from([
                    ("limit".into(), "100".into()),
                    (name.into(), value.into()),
                ]))
                .unwrap_err()
                .0,
                StatusCode::BAD_REQUEST,
                "{name}={value}"
            );
        }
    }

    #[tokio::test]
    async fn content_handlers_reject_invalid_ids_before_any_upstream_call() {
        let md = Md::new(manga_core::dns::PublicDns::client());
        for (result, message) in [
            (
                manga(State(md.clone()), Path("not-a-uuid".into())).await,
                "manga",
            ),
            (
                chapters(State(md.clone()), Path("google|opaque".into())).await,
                "chapters",
            ),
            (pages(State(md), Path("short".into())).await, "pages"),
        ] {
            let (status, Json(body)) = result.unwrap_err();
            assert_eq!(status, StatusCode::BAD_REQUEST, "{message}");
            assert_eq!(body.error.code, "VALIDATION_ERROR", "{message}");
        }
    }

    #[test]
    fn spa_routes_and_errors_must_revalidate() {
        for path in ["/", "/index.html", "/search", "/manga/abc", "/read/abc"] {
            assert_eq!(
                static_cache_control(path, StatusCode::OK, "text/html"),
                "no-cache",
                "{path}"
            );
        }
        assert_eq!(
            static_cache_control("/ui-deadbeef.wasm", StatusCode::NOT_FOUND, "text/plain"),
            "no-cache"
        );
    }

    #[test]
    fn successful_hashed_assets_are_immutable() {
        assert_eq!(
            static_cache_control("/ui-deadbeef_bg.wasm", StatusCode::OK, "application/wasm"),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn errors_use_the_shared_nested_contract() {
        let (status, Json(body)) = api_error(
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "Invalid manga id",
        );
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            serde_json::to_value(body).unwrap(),
            serde_json::json!({
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid manga id",
                    "details": {}
                }
            })
        );
    }
}
