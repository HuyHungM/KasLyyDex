use contracts::{MangaSummaryDto, SearchQuery, SearchResponse};
use std::cmp::Ordering;
use std::sync::Arc;

use crate::Md;

type Err = String;

const PAGE_SIZE: usize = 24;

struct ProviderPage {
    results: Vec<MangaSummaryDto>,
    total: u64,
    partial: bool,
}

/// MangaDex is the only content source. Every page up to the requested one is
/// collected before the deterministic sort and slice, so page N keeps the
/// correctly ranked hits from earlier pages.
pub async fn search_all(md: &Md, query: &SearchQuery) -> Result<SearchResponse, Err> {
    let key = cache_key(query);
    if let Some(cached) = md.cached_search(&key).await {
        if !cached.partial.unwrap_or(false) {
            return Ok((*cached).clone());
        }
    }

    let page = mangadex_page(md, query).await?;
    let mut results = page.results;
    results.sort_by(|a, b| compare(a, b, &query.sort));
    let start = query.page.saturating_sub(1) as usize * PAGE_SIZE;
    let results = results.into_iter().skip(start).take(PAGE_SIZE).collect();
    let response = SearchResponse {
        results,
        total: page.total,
        partial: Some(page.partial),
    };
    if !page.partial {
        md.cache_search(key, Arc::new(response.clone())).await;
    }
    Ok(response)
}

fn cache_key(query: &SearchQuery) -> String {
    // JSON-quoted keyword keeps the delimited key unambiguous for any text.
    let q = serde_json::to_string(&query.q).unwrap_or_default();
    format!(
        "aggregate|q{}:p{}:t{}:s{}:sort{}:src{}:lang{}:y{}",
        q,
        query.page,
        query.tags.join(","),
        query.status.as_deref().unwrap_or(""),
        query.sort,
        query.source,
        query.lang,
        query.year.map(|year| year.to_string()).unwrap_or_default(),
    )
}

async fn mangadex_page(md: &Md, query: &SearchQuery) -> Result<ProviderPage, Err> {
    let mut results = Vec::new();
    let mut total = 0;
    let mut partial = false;
    for page in 1..=query.page {
        let response = md
            .search_filtered(
                &query.q,
                page,
                &query.tags,
                query.status.as_deref(),
                &query.sort,
                &query.lang,
            )
            .await?;
        if page == 1 {
            total = response.total;
        }
        partial |= response.partial.unwrap_or(false);
        results.extend((*response).clone().results);
    }
    // MangaDex applies `lang` server-side via the official
    // `availableTranslatedLanguage[]` filter. Year has no upstream filter in
    // this adapter, so it is applied to the prefix only and marked partial.
    if let Some(year) = query.year {
        results.retain(|item| item.year == Some(year));
        partial = true;
    }
    Ok(ProviderPage {
        results,
        total,
        partial,
    })
}

fn compare(a: &MangaSummaryDto, b: &MangaSummaryDto, sort: &str) -> Ordering {
    let primary = match sort {
        "follows" => b.follows.unwrap_or(0).cmp(&a.follows.unwrap_or(0)),
        "rating" => b
            .rating
            .unwrap_or(0.0)
            .partial_cmp(&a.rating.unwrap_or(0.0))
            .unwrap_or(Ordering::Equal),
        // shortcut: no publish timestamp on the summary DTO; year is the closest
        // available proxy for "new". Revisit when upstream exposes publishAt.
        "new" | "year" => b.year.unwrap_or(0).cmp(&a.year.unwrap_or(0)),
        "title" => a.title.cmp(&b.title),
        _ => Ordering::Equal,
    };
    primary
        .then_with(|| a.source_label.cmp(&b.source_label))
        .then_with(|| a.title.cmp(&b.title))
        .then_with(|| a.id.as_str().cmp(b.id.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    const TAG: &str = "391b0423-d847-456f-aff0-8b0cfc03066b";

    #[derive(Clone)]
    struct Mode {
        items: Vec<Value>,
        fail: bool,
    }

    struct Fixture {
        base: String,
        paths: Arc<Mutex<Vec<String>>>,
        task: JoinHandle<()>,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl Fixture {
        fn paths(&self) -> Vec<String> {
            self.paths.lock().expect("fixture paths").clone()
        }
    }

    async fn fixture(items: Vec<Value>, fail: bool) -> Fixture {
        let mode = Mode { items, fail };
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fixture");
        let base = format!("http://{}", listener.local_addr().expect("fixture addr"));
        let paths = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&paths);
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let seen = Arc::clone(&seen);
                let mode = mode.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut buf = [0u8; 4096];
                    while data.windows(4).all(|w| w != b"\r\n\r\n") {
                        let Ok(n) = socket.read(&mut buf).await else {
                            break;
                        };
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&buf[..n]);
                    }
                    let request = String::from_utf8_lossy(&data);
                    let path = request.split_whitespace().nth(1).unwrap_or("").to_owned();
                    seen.lock().expect("fixture paths").push(path.clone());
                    let (body, failed) = respond(&mode, &path);
                    let status = if failed {
                        "500 Internal Server Error"
                    } else {
                        "200 OK"
                    };
                    let response = format!(
                        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        Fixture { base, paths, task }
    }

    fn path_param(path: &str, name: &str) -> Option<u32> {
        let query = path.split_once('?')?.1;
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
            .and_then(|value| value.parse().ok())
    }

    fn respond(mode: &Mode, path: &str) -> (String, bool) {
        if path.starts_with("/manga?") {
            let offset = path_param(path, "offset").unwrap_or(0) as usize;
            let limit = path_param(path, "limit").unwrap_or(PAGE_SIZE as u32) as usize;
            let page: Vec<_> = mode
                .items
                .iter()
                .skip(offset)
                .take(limit)
                .cloned()
                .collect();
            let total = mode.items.len();
            return (
                json!({ "total": total, "data": page }).to_string(),
                mode.fail,
            );
        }
        if path.starts_with("/statistics/manga") {
            let stats: serde_json::Map<String, Value> = mode
                .items
                .iter()
                .filter_map(|item| {
                    let id = item["id"].as_str()?;
                    Some((id.to_owned(), item["statistics"].clone()))
                })
                .collect();
            return (json!({ "statistics": stats }).to_string(), false);
        }
        (json!({ "total": 0, "data": [] }).to_string(), false)
    }

    fn md_item(id: &str, title: &str, follows: u64) -> Value {
        json!({
            "id": id,
            "attributes": {
                "title": { "en": title },
                "status": "ongoing",
                "year": 2024,
                "description": { "en": "fixture" },
                "tags": []
            },
            "relationships": [],
            "statistics": { "follows": follows }
        })
    }

    fn query(source: &str, lang: &str, sort: &str) -> SearchQuery {
        SearchQuery {
            q: String::new(),
            page: 1,
            tags: vec![],
            status: None,
            sort: sort.into(),
            source: source.into(),
            lang: lang.into(),
            year: None,
        }
    }

    fn md_search_path(fx: &Fixture) -> String {
        fx.paths()
            .into_iter()
            .find(|path| path.starts_with("/manga?"))
            .expect("MangaDex search request")
    }

    #[test]
    fn cache_key_covers_every_query_field() {
        let base = query("all", "all", "follows");
        let mut other = base.clone();
        other.q = "ab".into();
        let mut third = base.clone();
        third.q = "cd".into();
        assert_ne!(cache_key(&other), cache_key(&third));
        for (mut changed, label) in [
            (base.clone(), "page"),
            (base.clone(), "tags"),
            (base.clone(), "status"),
            (base.clone(), "sort"),
            (base.clone(), "source"),
            (base.clone(), "lang"),
            (base.clone(), "year"),
        ] {
            match label {
                "page" => changed.page = 2,
                "tags" => changed.tags = vec![TAG.into()],
                "status" => changed.status = Some("ongoing".into()),
                "sort" => changed.sort = "title".into(),
                "source" => changed.source = "mangadex".into(),
                "lang" => changed.lang = "vi".into(),
                "year" => changed.year = Some(2024),
                _ => unreachable!(),
            }
            assert_ne!(
                cache_key(&base),
                cache_key(&changed),
                "{label} missing from key"
            );
        }
    }

    #[tokio::test]
    async fn search_uses_mangadex_only() {
        let md_fx = fixture(vec![md_item("md-1", "Only MD", 1)], false).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let response = search_all(&md, &query("all", "all", "follows"))
            .await
            .expect("search succeeds");

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].id.as_str(), "md-1");
        assert_eq!(response.results[0].source_label, "MangaDex");
        assert_eq!(response.total, 1);
        assert_eq!(response.partial, Some(false));
        assert_eq!(
            md_fx
                .paths()
                .iter()
                .filter(|path| path.starts_with("/manga?"))
                .count(),
            1,
            "search must call MangaDex once"
        );
    }

    #[tokio::test]
    async fn mangadex_lang_filters_upstream_and_all_keeps_legacy_path() {
        for lang in ["vi", "en"] {
            let md_fx = fixture(vec![md_item("md-1", "Localized", 1)], false).await;
            let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
            let response = search_all(&md, &query("mangadex", lang, "follows"))
                .await
                .expect("mangadex language search succeeds");
            let path = md_search_path(&md_fx);
            assert!(
                path.contains(&format!("availableTranslatedLanguage[]={lang}")),
                "missing official language filter: {path}"
            );
            assert_eq!(response.partial, Some(false));
        }

        let md_fx = fixture(vec![md_item("md-1", "Legacy", 1)], false).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let response = search_all(&md, &query("mangadex", "all", "follows"))
            .await
            .expect("legacy search succeeds");
        let path = md_search_path(&md_fx);
        assert!(!path.contains("availableTranslatedLanguage"), "{path}");
        assert!(!path.contains("translatedLanguage"), "{path}");
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn source_all_lang_vi_filters_mangadex() {
        let md_fx = fixture(vec![md_item("md-1", "Vietnamese", 1)], false).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let response = search_all(&md, &query("all", "vi", "follows"))
            .await
            .expect("language-filtered search succeeds");

        let md_path = md_search_path(&md_fx);
        assert!(
            md_path.contains("availableTranslatedLanguage[]=vi"),
            "MangaDex did not receive the language filter: {md_path}"
        );
        assert_eq!(response.results[0].source, "mangadex");
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn search_sorts_deterministically() {
        let md_fx = fixture(
            vec![md_item("md-b", "Beta", 5), md_item("md-a", "Alpha", 9)],
            false,
        )
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let response = search_all(&md, &query("all", "all", "follows"))
            .await
            .expect("search succeeds");

        let ids: Vec<_> = response.results.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["md-a", "md-b"]);
        assert_eq!(response.total, 2);
    }

    #[tokio::test]
    async fn search_returns_error_when_mangadex_fails() {
        let md_fx = fixture(vec![], true).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        assert!(search_all(&md, &query("all", "all", "follows"))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn search_pages_to_24_and_sums_totals_before_slicing() {
        let items = (0..25)
            .map(|i| md_item(&format!("md-{i}"), &format!("Title {i}"), i))
            .collect();
        let md_fx = fixture(items, false).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let response = search_all(&md, &query("mangadex", "all", "title"))
            .await
            .expect("search succeeds");

        assert_eq!(response.results.len(), 24);
        assert_eq!(response.total, 25);
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn page_2_uses_full_prefix_before_slicing() {
        let items = (0..30)
            .map(|i| md_item(&format!("md-{i:02}"), &format!("A-{i:02}"), i))
            .collect();
        let md_fx = fixture(items, false).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let mut cfg = query("all", "all", "title");
        cfg.page = 2;
        let response = search_all(&md, &cfg).await.expect("page 2 succeeds");

        let expected: Vec<String> = (24..30).map(|i| format!("md-{i:02}")).collect();
        let ids: Vec<_> = response.results.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, expected.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(response.partial, Some(false));
    }
}
