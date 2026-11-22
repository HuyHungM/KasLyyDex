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
const COMICK_PAGE_SIZE: u32 = 15;
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

/// Merges each provider's full prefix through the requested page, then slices
/// the deterministically sorted result once.
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
            let (md_page, comick_page) =
                tokio::join!(mangadex_page(md, query), comick_page_for(comick, query));
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
        return Err(
            first_error.unwrap_or_else(|| "No content provider could answer the search.".into())
        );
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

/// Collects every MangaDex page up to the requested one. The aggregator slices
/// after merging, so a provider that only supplied page N would lose the
/// correctly-ranked hits from earlier pages.
async fn mangadex_page(md: &Md, query: &SearchQuery) -> ProviderPage {
    let mut results = Vec::new();
    let mut total = 0;
    let mut partial = false;
    for page in 1..=query.page {
        let response = match md
            .search_filtered(
                &query.q,
                page,
                &query.tags,
                query.status.as_deref(),
                &query.sort,
                &query.lang,
            )
            .await
        {
            Ok(response) => response,
            Err(error) => return ProviderPage::failed(error),
        };
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
    ProviderPage {
        results,
        total,
        partial,
        error: None,
    }
}

/// Collects every Comick page needed for a full `page * 24` prefix. Upstream
/// pages hold 15 hits, so page N needs `ceil(N*24/15)` of them, capped at the
/// documented page <= 50. Page 1 keeps the legacy single-request behavior.
async fn comick_page_for(comick: &Comick, query: &SearchQuery) -> ProviderPage {
    if query.page > COMICK_MAX_PAGE {
        return ProviderPage {
            results: Vec::new(),
            total: 0,
            partial: true,
            error: None,
        };
    }
    let needed = if query.page == 1 {
        1
    } else {
        query
            .page
            .saturating_mul(PAGE_SIZE as u32)
            .div_ceil(COMICK_PAGE_SIZE)
    };
    // A capped prefix cannot be exhaustive; never present its count as total.
    let capped = needed > COMICK_MAX_PAGE;
    let last = needed.min(COMICK_MAX_PAGE);
    let mut results = Vec::new();
    for page in 1..=last {
        match comick.search(&query.q, &query.lang, query.year, page).await {
            Ok(items) => results.extend(items),
            Err(error) => return ProviderPage::failed(error),
        }
    }
    // Verified official /genre/ slugs exist, but no official endpoint maps a
    // MangaDex tag UUID to a Comick genre slug. Never guess one: report partial.
    // /v1.0/search/ has no `lang` field and the summary hit carries no language,
    // so Comick results cannot be language-filtered without per-title lookups;
    // report partial instead of inventing a param or dropping hits. `status` is
    // filtered locally for the same "cannot guarantee full coverage" reason.
    if let Some(status) = query.status.as_deref() {
        results.retain(|item| item.status == status);
    }
    ProviderPage {
        total: results.len() as u64,
        partial: capped || query.lang != "all" || !query.tags.is_empty() || query.status.is_some(),
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
    use std::sync::{Arc, Mutex};
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
        paths: Arc<Mutex<Vec<String>>>,
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

        fn paths(&self) -> Vec<String> {
            self.paths.lock().expect("fixture paths").clone()
        }
    }

    async fn fixture(mode: Mode) -> Fixture {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fixture");
        let base = format!("http://{}", listener.local_addr().expect("fixture addr"));
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&hits);
        let paths = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&paths);
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let counter = Arc::clone(&counter);
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
                    counter.fetch_add(1, Ordering::Relaxed);
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
        Fixture {
            base,
            hits,
            paths,
            task,
        }
    }

    fn path_param(path: &str, name: &str) -> Option<u32> {
        let query = path.split_once('?')?.1;
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(&format!("{name}=")))
            .and_then(|value| value.parse().ok())
    }

    fn respond(mode: &Mode, path: &str) -> (String, bool) {
        match mode {
            Mode::Md { items, fail } => {
                if path.starts_with("/manga?") {
                    let offset = path_param(path, "offset").unwrap_or(0) as usize;
                    let limit = path_param(path, "limit").unwrap_or(PAGE_SIZE as u32) as usize;
                    let page: Vec<_> = items.iter().skip(offset).take(limit).cloned().collect();
                    let total = items.len();
                    return (json!({ "total": total, "data": page }).to_string(), *fail);
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
                    let start =
                        path_param(path, "page").unwrap_or(1).saturating_sub(1) as usize * 15;
                    let page: Vec<_> = hits.iter().skip(start).take(15).cloned().collect();
                    return (json!(page).to_string(), *fail);
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
            assert_ne!(
                cache_key(&base),
                cache_key(&changed),
                "{label} missing from key"
            );
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

    fn md_search_path(fx: &Fixture) -> String {
        fx.paths()
            .into_iter()
            .find(|path| path.starts_with("/manga?"))
            .expect("MangaDex search request")
    }

    #[tokio::test]
    async fn mangadex_lang_filters_upstream_and_all_keeps_legacy_path() {
        for lang in ["vi", "en"] {
            let md_fx = fixture(Mode::Md {
                items: vec![md_item("md-1", "Localized", 1)],
                fail: false,
            })
            .await;
            let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
            let response = search_all(&md, None, &query("mangadex", lang, "follows"))
                .await
                .expect("mangadex language search succeeds");
            let path = md_search_path(&md_fx);
            assert!(
                path.contains(&format!("availableTranslatedLanguage[]={lang}")),
                "missing official language filter: {path}"
            );
            assert_eq!(response.partial, Some(false));
        }

        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Legacy", 1)],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let response = search_all(&md, None, &query("mangadex", "all", "follows"))
            .await
            .expect("legacy search succeeds");
        let path = md_search_path(&md_fx);
        assert!(!path.contains("availableTranslatedLanguage"), "{path}");
        assert!(!path.contains("translatedLanguage"), "{path}");
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn source_all_lang_vi_filters_mangadex_and_marks_comick_partial() {
        let md_fx = fixture(Mode::Md {
            items: vec![md_item("md-1", "Vietnamese", 1)],
            fail: false,
        })
        .await;
        let ck_fx = fixture(Mode::Comick {
            hits: vec![comick_hit("ck-1", "Shared", 1, "5.0")],
            fail: false,
        })
        .await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let response = search_all(&md, Some(&comick), &query("all", "vi", "follows"))
            .await
            .expect("language-filtered multi-source search succeeds");

        let md_path = md_search_path(&md_fx);
        assert!(
            md_path.contains("availableTranslatedLanguage[]=vi"),
            "MangaDex did not receive the language filter: {md_path}"
        );
        assert!(
            ck_fx.paths().iter().all(|path| !path.contains("lang=")),
            "Comick must not receive an invented lang param: {:?}",
            ck_fx.paths()
        );
        let sources: Vec<_> = response
            .results
            .iter()
            .map(|item| item.source.as_str())
            .collect();
        assert!(sources.contains(&"mangadex"));
        assert!(sources.contains(&"comick"));
        assert_eq!(
            response.partial,
            Some(true),
            "Comick cannot be language-filtered"
        );
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
            items: vec![md_item("md-b", "Beta", 5), md_item("md-a", "Alpha", 9)],
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

        let ids: Vec<_> = response.results.iter().map(|r| r.id.as_str()).collect();
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
        assert_eq!(
            ck_fx.count(),
            0,
            "page 51 is outside the official Comick cap"
        );

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

    #[tokio::test]
    async fn source_all_page_2_uses_full_prefix_before_slicing() {
        let items = (0..30)
            .map(|i| md_item(&format!("md-{i:02}"), &format!("A-{i:02}"), i))
            .collect();
        let md_fx = fixture(Mode::Md { items, fail: false }).await;
        let hits = (0..30)
            .map(|i| comick_hit(&format!("ck-{i:02}"), &format!("B-{i:02}"), i, "5.0"))
            .collect();
        let ck_fx = fixture(Mode::Comick { hits, fail: false }).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let mut cfg = query("all", "all", "title");
        cfg.page = 2;
        let response = search_all(&md, Some(&comick), &cfg)
            .await
            .expect("multi-source page 2 succeeds");

        let expected: Vec<String> = (24..30)
            .map(|i| format!("md-{i:02}"))
            .chain((0..18).map(|i| format!("comick:ck-{i:02}")))
            .collect();
        let ids: Vec<_> = response.results.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, expected.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn comick_page_2_fetches_full_prefix() {
        let md_fx = fixture(Mode::Md {
            items: vec![],
            fail: false,
        })
        .await;
        let hits = (0..60)
            .map(|i| comick_hit(&format!("ck-{i:02}"), &format!("T-{i:02}"), i, "5.0"))
            .collect();
        let ck_fx = fixture(Mode::Comick { hits, fail: false }).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let mut cfg = query("comick", "all", "title");
        cfg.page = 2;
        let response = search_all(&md, Some(&comick), &cfg)
            .await
            .expect("comick page 2 succeeds");

        let expected: Vec<String> = (24..48).map(|i| format!("comick:ck-{i:02}")).collect();
        let ids: Vec<_> = response.results.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, expected.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(ck_fx.count(), 4, "page 2 needs four 15-item Comick pages");
        assert_eq!(response.partial, Some(false));
    }

    #[tokio::test]
    async fn comick_prefix_capped_at_documented_page_is_partial() {
        let md_fx = fixture(Mode::Md {
            items: vec![],
            fail: false,
        })
        .await;
        let hits = (0..60)
            .map(|i| comick_hit(&format!("ck-{i:02}"), &format!("T-{i:02}"), i, "5.0"))
            .collect();
        let ck_fx = fixture(Mode::Comick { hits, fail: false }).await;
        let md = Md::with_origin(reqwest::Client::new(), md_fx.base.clone());
        let comick = Comick::with_origin(ck_fx.base.clone());

        let mut cfg = query("comick", "all", "title");
        cfg.page = 32; // needs 52 Comick pages, past the documented cap of 50
        let response = search_all(&md, Some(&comick), &cfg)
            .await
            .expect("capped comick search still responds");

        assert_eq!(ck_fx.count(), 50, "fetching stops at the documented cap");
        assert_eq!(
            response.partial,
            Some(true),
            "a capped prefix is not exhaustive"
        );
    }
}
