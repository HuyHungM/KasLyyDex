use contracts::{MangaSummaryDto, SearchQuery, SearchResponse};
use std::cmp::Ordering;
use std::sync::Arc;

use crate::{Comick, Md};

type Err = String;

/// Sentinel for a query that requires an unconfigured provider. Kept distinct
/// from upstream error text so a failed request is a 502, not a 503.
pub const CONTENT_UNAVAILABLE: &str = "Comick provider is not configured";

/// Comick's official search declares page <= 50 (limit <= 50). A page past that
/// cannot be fetched, so it is reported partial instead of silently truncated.
const COMICK_MAX_PAGE: u32 = 50;
const PAGE_SIZE: usize = 24;

struct ProviderPage {
    results: Vec<MangaSummaryDto>,
    total: u64,
    partial: bool,
    error: Option<Err>,
}

impl ProviderPage {
    fn failed(error: Err) -> Self {
        Self {
            results: Vec::new(),
            total: 0,
            partial: true,
            error: Some(error),
        }
    }
}

/// Merges one page of results from the selected catalog providers.
pub async fn search_all(
    md: &Md,
    comick: Option<&Comick>,
    query: &SearchQuery,
) -> Result<SearchResponse, Err> {
    let use_md = matches!(query.source.as_str(), "all" | "mangadex");
    let use_comick = matches!(query.source.as_str(), "all" | "comick");
    let comick = if use_comick {
        Some(comick.ok_or_else(|| CONTENT_UNAVAILABLE.to_owned())?)
    } else {
        None
    };

    let key = cache_key(query);
    if let Some(cached) = md.cached_search(&key).await {
        if !cached.partial.unwrap_or(false) {
            return Ok((*cached).clone());
        }
    }

    // Independent failures: one healthy provider still answers, marked partial.
    let (md_page, comick_page) = match (use_md, comick) {
        (true, Some(comick)) => {
            let (md_page, comick_page) = tokio::join!(
                mangadex_page(md, query),
                comick_page_for(comick, query)
            );
            (Some(md_page), Some(comick_page))
        }
        (true, None) => (Some(mangadex_page(md, query).await), None),
        (false, Some(comick)) => (None, Some(comick_page_for(comick, query).await)),
        (false, None) => unreachable!("source=all|mangadex|comick is validated upstream"),
    };

    let mut providers = Vec::with_capacity(2);
    let mut partial = false;
    let mut first_error = None;
    for page in [md_page, comick_page].into_iter().flatten() {
        partial |= page.partial || page.error.is_some();
        match page.error {
            Some(error) => {
                first_error.get_or_insert(error);
            }
            None => providers.push(page),
        }
    }
    if providers.is_empty() {
        return Err(first_error.unwrap_or_else(|| "No content provider could answer the search.".into()));
    }

    let total = providers.iter().map(|page| page.total).sum();
    let mut results: Vec<_> = providers
        .into_iter()
        .flat_map(|page| page.results)
        .collect();
    results.sort_by(|a, b| compare(a, b, &query.sort));
    let start = query.page.saturating_sub(1) as usize * PAGE_SIZE;
    let results = results.into_iter().skip(start).take(PAGE_SIZE).collect();
    let response = SearchResponse {
        results,
        total,
        partial: Some(partial),
    };
    if !partial {
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

async fn mangadex_page(md: &Md, query: &SearchQuery) -> ProviderPage {
    let response = match md
        .search_filtered(
            &query.q,
            query.page,
            &query.tags,
            query.status.as_deref(),
            &query.sort,
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return ProviderPage::failed(error),
    };
    // MangaDex has no language filter on /manga and no publication-year filter
    // in this adapter. Year is applied to the returned page only; both are
    // marked partial because the full result set cannot be guaranteed.
    let mut results = (*response).clone().results;
    if let Some(year) = query.year {
        results.retain(|item| item.year == Some(year));
    }
    ProviderPage {
        results,
        total: response.total,
        partial: response.partial.unwrap_or(false)
            || query.lang != "all"
            || query.year.is_some(),
        error: None,
    }
}

async fn comick_page_for(comick: &Comick, query: &SearchQuery) -> ProviderPage {
    if query.page > COMICK_MAX_PAGE {
        return ProviderPage {
            results: Vec::new(),
            total: 0,
            partial: true,
            error: None,
        };
    }
    let results = match comick
        .search(&query.q, &query.lang, query.year, query.page)
        .await
    {
        Ok(results) => results,
        Err(error) => return ProviderPage::failed(error),
    };
    // Verified official /genre/ slugs exist, but no official endpoint maps a
    // MangaDex tag UUID to a Comick genre slug. Never guess one: report partial.
    // `lang` and `status` are not search filters on /v1.0/search/, so local
    // filtering cannot guarantee full coverage either.
    let mut results = results;
    if let Some(status) = query.status.as_deref() {
        results.retain(|item| item.status == status);
    }
    ProviderPage {
        total: results.len() as u64,
        partial: query.lang != "all" || !query.tags.is_empty() || query.status.is_some(),
        results,
        error: None,
    }
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    const TAG: &str = "391b0423-d847-456f-aff0-8b0cfc03066b";

    #[derive(Clone)]
    enum Mode {
        Md { items: Vec<Value>, fail: bool },
        Comick { hits: Vec<Value>, fail: bool },
    }

    struct Fixture {
        base: String,
        hits: Arc<AtomicUsize>,
        task: JoinHandle<()>,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl Fixture {
        fn count(&self) -> usize {
            self.hits.load(Ordering::Relaxed)
        }
    }

    async fn fixture(mode: Mode) -> Fixture {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind fixture");
        let base = format!("http://{}", listener.local_addr().expect("fixture addr"));
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&hits);
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let counter = Arc::clone(&counter);
                let mode = mode.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut buf = [0u8; 4096];
                    while data.windows(4).all(|w| w != b"\r\n\r\n") {
                        let Ok(n) = socket.read(&mut buf).await else { break };
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&buf[..n]);
                    }
                    counter.fetch_add(1, Ordering::Relaxed);
                    let request = String::from_utf8_lossy(&data);
                    let path = request.split_whitespace().nth(1).unwrap_or("");
                    let (body, failed) = respond(&mode, path);
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
        Fixture { base, hits, task }
    }

    fn respond(mode: &Mode, path: &str) -> (String, bool) {
        match mode {
            Mode::Md { items, fail } => {
                if path.starts_with("/manga?") {
                    let total = items.len();
                    return (json!({ "total": total, "data": items }).to_string(), *fail);
                }
                if path.starts_with("/statistics/manga") {
                    let stats: serde_json::Map<String, Value> = items
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
            Mode::Comick { hits, fail } => {
                if path.starts_with("/v1.0/search/") {
                    return (json!(hits).to_string(), *fail);
                }
                ("[]".into(), false)
            }
        }
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

    fn comick_hit(hid: &str, title: &str, follows: u64, rating: &str) -> Value {
        json!({
            "hid": hid,
            "title": title,
            "desc": "modern Comick hit",
            "status": 1,
            "year": 2024,
            "genres": [30, 244],
            "md_covers": [{ "b2key": "cover.jpg" }],
            "bayesian_rating": rating,
            "user_follow_count": follows,
            "last_chapter": 10
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
                "source" => changed.source = "comick".into(),
                "lang" => changed.lang = "vi".into(),
                "year" => changed.year = Some(2024),
                _ => unreachable!(),
            }
            assert_ne!(cache_key(&base), cache_key(&changed), "{label} missing from key");
        }
    }

    #[tokio::test]
    async fn search_mangadex_only_preserves_existing_behavior() {
        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Only MD", 1)],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![comick_hit("ck-1", "Only Comick", 9, "9.0")],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("mangadex", "all", "follows"))
            .await
            .expect("mangadex search succeeds");

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].id.as_str(), "md-1");
        assert_eq!(response.results[0].source_label, "MangaDex");
        assert_eq!(response.total, 1);
        assert_eq!(response.partial, Some(false));
        assert_eq!(ck_fx.count(), 0, "MangaDex-only search called Comick");
    }

    #[tokio::test]
    async fn search_comick_only_uses_adapter() {
        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Only MD", 1)],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![comick_hit("ck-1", "Only Comick", 9, "9.0")],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("comick", "all", "follows"))
            .await
            .expect("comick search succeeds");

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].id.as_str(), "comick:ck-1");
        assert_eq!(response.results[0].source_label, "Comick");
        assert_eq!(response.results[0].description, "modern Comick hit");
        assert_eq!(response.results[0].tags, ["30", "244"]);
        assert_eq!(
            response.results[0].cover_file.as_deref(),
            Some("https://meo.comick.pictures/cover.jpg")
        );
        assert_eq!(response.total, 1);
        assert_eq!(response.partial, Some(false));
        assert_eq!(md_fx.count(), 0, "Comick-only search called MangaDex");
    }

    #[tokio::test]
    async fn search_all_keeps_provider_duplicates_separate() {
        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Same Title", 3)],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![comick_hit("ck-1", "same title", 3, "7.0")],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("all", "all", "follows"))
            .await
            .expect("multi-source search succeeds");

        assert_eq!(response.results.len(), 2);
        assert_eq!(response.total, 2);
        let sources: Vec<_> = response.results.iter().map(|r| r.source.as_str()).collect();
        assert!(sources.contains(&"mangadex"));
        assert!(sources.contains(&"comick"));
        assert!(
            response
                .results
                .iter()
                .all(|r| r.title.eq_ignore_ascii_case("Same Title")),
            "provider duplicates must not be collapsed"
        );
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn search_all_merges_and_sorts_deterministically() {
        let md_fx = fixture(Mode::Md {
            items: vec![
                md_item("md-b", "Beta", 5),
                md_item("md-a", "Alpha", 9),
            ],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![
                comick_hit("ck-1", "Alpha", 9, "8.0"),
                comick_hit("ck-2", "Zeta", 1, "6.0"),
            ],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("all", "all", "follows"))
            .await
            .expect("multi-source search succeeds");

        let ids: Vec<_> = response
            .results
            .iter()
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(ids, ["comick:ck-1", "md-a", "md-b", "comick:ck-2"]);
        assert_eq!(response.total, 4);
    }

    #[tokio::test]
    async fn search_all_partial_when_one_provider_fails() {
        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Still Here", 1)],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![],
            fail: true,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("all", "all", "follows"))
            .await
            .expect("one healthy provider is enough");

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].source, "mangadex");
        assert_eq!(response.partial, Some(true));
    }

    #[tokio::test]
    async fn search_all_pages_to_24_and_sums_totals_before_slicing() {
        let items = (0..25)
            .map(|i| md_item(&format!("md-{i}"), &format!("Title {i}"), i))
            .collect();
        let md_fx = fixture(Mode::Md { items, fail: false }).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        let response = search_all(&md, None, &query("mangadex", "all", "title"))
            .await
            .expect("mangadex search succeeds");

        assert_eq!(response.results.len(), 24);
        assert_eq!(response.total, 25);
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn comick_filters_that_cannot_be_guaranteed_are_partial() {
        let md_fx = fixture(Mode::Md {
            items: vec![],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![comick_hit("ck-1", "Hit", 1, "5.0")],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let mut cfg = query("comick", "vi", "follows");
        cfg.tags = vec![TAG.into()];
        cfg.page = 51;
        let response = search_all(&md, Some(&comick), &cfg)
            .await
            .expect("partial comick search is still a response");
        assert_eq!(response.results.len(), 0);
        assert_eq!(response.partial, Some(true));
        assert_eq!(ck_fx.count(), 0, "page 51 is outside the official Comick cap");

        let mut cfg = query("comick", "all", "follows");
        cfg.tags = vec![TAG.into()];
        let response = search_all(&md, Some(&comick), &cfg)
            .await
            .expect("tag-filtered comick search succeeds");
        assert_eq!(response.partial, Some(true));
        assert_eq!(response.results.len(), 1);
    }

    #[tokio::test]
    async fn comick_requires_a_configured_adapter() {
        let md_fx = fixture(Mode::Md {
            items: vec![],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());

        for source in ["comick", "all"] {
            let error = search_all(&md, None, &query(source, "all", "follows"))
                .await
                .expect_err("missing Comick adapter must be reported");
            assert_eq!(error, CONTENT_UNAVAILABLE);
        }
    }
}
