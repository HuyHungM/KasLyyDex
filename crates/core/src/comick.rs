// Verified 2026-11-21 from the official Comick catalog OpenAPI document at
// https://api.comick.dev/docs/json (rendered by https://api.comick.dev/docs/):
// - GET /v1.0/search/?q=...&page=1&limit=15 — bare array; page <= 50 with
//   limit <= 50, or page <= 5 with limit <= 300; defaults page=1, limit=15.
//   Verified search filter names: q (keyword, optional for browse), page,
//   limit, from/to (inclusive publication year), status (1 ongoing,
//   2 completed, 3 cancelled, 4 hiatus), genres (request: slugs from /genre/;
//   response: numeric ids), md_covers[].b2key, bayesian_rating,
//   user_follow_count, last_chapter. There is NO documented `lang` filter on
//   this route: language is applied by the aggregator, not invented here.
// - GET /v1.0/comic/{hid}/chapters?lang=...&page=1&limit=12 — returns
//   { chapters, total, limit, checkVol2Chap1 }; default page size 12, no max.
// - GET /chapter/{hid}/get_images — ordered image metadata array, may be [].
// - Origin budget: 200 requests/minute/client IP.
// - CDN image host listed in the official spec: meo.comick.pictures (HTTPS);
//   live delivery and ToS remain a manual release gate (no live fetch gate here).
// OAuth/Library endpoints are deliberately not used.

use contracts::MangaSummaryDto;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::time::Duration;

const API: &str = "https://api.comick.dev";
const CDN: &str = "https://meo.comick.pictures";
const CDN_HOST: &str = "meo.comick.pictures";
const TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const UPSTREAM_ERR: &str = "Comick catalog unavailable";

type Err = String;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComickTitle {
    pub hid: String,
    pub title: String,
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComickChapter {
    pub id: String,
    pub chapter: Option<String>,
    pub lang: String,
    pub title: String,
    pub publish_at: String,
    pub group: String,
}

#[derive(Clone)]
pub struct Comick {
    http: reqwest::Client,
    api: String,
}

impl Default for Comick {
    fn default() -> Self {
        Self::new()
    }
}

impl Comick {
    pub fn new() -> Self {
        let origin = std::env::var("COMICK_API_ORIGIN").unwrap_or_else(|_| API.to_owned());
        Self::with_origin(origin)
    }

    /// Explicit origin for local upstream fixtures; production uses `new()`.
    pub fn with_origin(origin: String) -> Self {
        let trimmed = origin.trim().trim_end_matches('/').to_owned();
        Self {
            http: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .connect_timeout(CONNECT_TIMEOUT)
                .build()
                .expect("comick http client"),
            api: if trimmed.is_empty() {
                API.to_owned()
            } else {
                trimmed
            },
        }
    }

    pub async fn search_titles(&self, query: &str) -> Result<Vec<ComickTitle>, Err> {
        let body = self.get_json(&search_path(query, "all", None, 1)?).await?;
        let results = body.as_array().ok_or_else(upstream_err)?;
        results.iter().map(title_from_value).collect()
    }

    /// `lang` belongs to the shared search contract; the official search route
    /// has no language filter, so the aggregator applies it locally.
    pub async fn search(
        &self,
        q: &str,
        lang: &str,
        year: Option<i32>,
        page: u32,
    ) -> Result<Vec<MangaSummaryDto>, Err> {
        let body = self.get_json(&search_path(q, lang, year, page)?).await?;
        let results = body.as_array().ok_or_else(upstream_err)?;
        results.iter().map(normalize_search_hit).collect()
    }

    /// Comic detail by prefixed ID; the official route accepts a slug or HID.
    pub async fn detail(&self, id: &str) -> Result<MangaSummaryDto, Err> {
        let body = self.get_json(&comic_path(id)?).await?;
        normalize_detail(&body)
    }

    pub async fn chapters(&self, hid: &str, lang: &str) -> Result<Vec<ComickChapter>, Err> {
        let body = self.get_json(&chapters_path(hid, lang)?).await?;
        let chapters = body["chapters"].as_array().ok_or_else(upstream_err)?;
        chapters
            .iter()
            .map(|value| chapter_from_value(value, lang).ok_or_else(upstream_err))
            .collect()
    }

    pub async fn page_urls(&self, chapter_id: &str) -> Result<Vec<String>, Err> {
        let body = self.get_json(&images_path(chapter_id)?).await?;
        let images = body.as_array().ok_or_else(upstream_err)?;
        page_urls_from(images)
    }

    async fn get_json(&self, path: &str) -> Result<Value, Err> {
        let response = self
            .http
            .get(format!("{}{path}", self.api))
            .send()
            .await
            .map_err(|_| upstream_err())?;
        if !response.status().is_success() {
            return Err(upstream_err());
        }
        response.json::<Value>().await.map_err(|_| upstream_err())
    }
}

/// Provider-prefixed chapter IDs used by content routes and progress records.
pub fn is_comick_chapter_id(id: &str) -> bool {
    id.strip_prefix("comick:").is_some_and(valid_opaque)
}

/// Provider-prefixed comic IDs accepted by detail and chapter routes.
pub fn is_comick_manga_id(id: &str) -> bool {
    id.strip_prefix("comick:").is_some_and(valid_opaque)
}

fn upstream_err() -> Err {
    UPSTREAM_ERR.to_owned()
}

fn valid_opaque(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| !c.is_whitespace() && !c.is_control() && !matches!(c, '/' | '?' | '#'))
}

/// Accepts a provider-prefixed ID or a bare HID for internal catalog calls.
fn request_opaque(id: &str) -> Option<&str> {
    let raw = id.strip_prefix("comick:").unwrap_or(id);
    valid_opaque(raw).then_some(raw)
}

fn encode(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

pub fn search_path(q: &str, lang: &str, year: Option<i32>, page: u32) -> Result<String, Err> {
    // `lang` is validated for the shared contract but is not an upstream field.
    request_opaque(lang).ok_or_else(upstream_err)?;
    let q = q.trim();
    if q.chars().count() > 200 || !(1..=50).contains(&page) {
        return Err(upstream_err());
    }
    if year.is_some_and(|year| year < 1900) {
        return Err(upstream_err());
    }
    let years = year
        .map(|year| format!("&from={year}&to={year}"))
        .unwrap_or_default();
    // q is optional upstream: omit it for browse/filter-only searches.
    let keyword = if q.is_empty() {
        String::new()
    } else {
        format!("q={}&", encode(q))
    };
    Ok(format!(
        "/v1.0/search/?{keyword}page={page}&limit=15{years}"
    ))
}

/// Required fields are never filled in; optional fields use DTO defaults.
pub fn normalize_search_hit(hit: &Value) -> Result<MangaSummaryDto, Err> {
    let hid = hit["hid"]
        .as_str()
        .filter(|hid| valid_opaque(hid))
        .ok_or_else(upstream_err)?;
    let title = hit["title"]
        .as_str()
        .filter(|title| !title.trim().is_empty())
        .ok_or_else(upstream_err)?;
    let genres: Vec<String> = hit["genres"]
        .as_array()
        .map(|values| values.iter().filter_map(string_or_number).collect())
        .unwrap_or_default();
    let cover_file = hit["md_covers"]
        .as_array()
        .and_then(|covers| covers.first())
        .and_then(|cover| image_url(cover).ok());
    let status = match hit["status"].as_i64() {
        Some(1) => "ongoing",
        Some(2) => "completed",
        Some(3) => "cancelled",
        Some(4) => "hiatus",
        _ => hit["status"].as_str().unwrap_or_default(),
    };
    Ok(MangaSummaryDto {
        id: format!("comick:{hid}").into(),
        title: title.to_owned(),
        cover_file,
        status: status.to_owned(),
        year: hit["year"]
            .as_i64()
            .and_then(|year| i32::try_from(year).ok()),
        description: hit["desc"].as_str().unwrap_or_default().to_owned(),
        tags: genres.clone(),
        tag_ids: genres,
        author: String::new(),
        artist: String::new(),
        rating: hit["bayesian_rating"]
            .as_str()
            .and_then(|rating| rating.parse().ok()),
        follows: hit["user_follow_count"].as_u64(),
        latest_chapter: string_or_number(&hit["last_chapter"]),
        source: "comick".to_owned(),
        source_label: "Comick".to_owned(),
    })
}

fn comic_path(id: &str) -> Result<String, Err> {
    let hid = request_opaque(id).ok_or_else(upstream_err)?;
    Ok(format!("/v1.0/comic/{}/", encode(hid)))
}

/// Detail responses nest the comic under `comic` and expose genres as
/// `md_comic_md_genres`; the shared hit normalizer expects `genres`.
fn normalize_detail(body: &Value) -> Result<MangaSummaryDto, Err> {
    let mut comic = body
        .get("comic")
        .and_then(Value::as_object)
        .ok_or_else(upstream_err)?
        .clone();
    if comic.get("genres").is_none() {
        let genres: Vec<String> = comic["md_comic_md_genres"]
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry["md_genres"]["slug"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        if !genres.is_empty() {
            comic.insert("genres".into(), json!(genres));
        }
    }
    normalize_search_hit(&Value::Object(comic))
}

fn chapters_path(hid: &str, lang: &str) -> Result<String, Err> {
    let hid = request_opaque(hid).ok_or_else(upstream_err)?;
    let lang = request_opaque(lang).ok_or_else(upstream_err)?;
    Ok(format!(
        "/v1.0/comic/{}/chapters?lang={}&page=1&limit=12",
        encode(hid),
        encode(lang)
    ))
}

fn images_path(chapter_id: &str) -> Result<String, Err> {
    let hid = request_opaque(chapter_id).ok_or_else(upstream_err)?;
    Ok(format!("/chapter/{}/get_images", encode(hid)))
}

fn title_from_value(value: &Value) -> Result<ComickTitle, Err> {
    let hid = value["hid"]
        .as_str()
        .filter(|hid| valid_opaque(hid))
        .ok_or_else(upstream_err)?;
    let title = value["title"].as_str().ok_or_else(upstream_err)?.to_owned();
    let aliases = value["md_titles"]
        .as_array()
        .map(|titles| {
            titles
                .iter()
                .filter_map(|title| {
                    title["title"]
                        .as_str()
                        .filter(|title| !title.trim().is_empty())
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ComickTitle {
        hid: format!("comick:{hid}"),
        title,
        aliases,
    })
}

fn string_or_number(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn chapter_from_value(value: &Value, fallback_lang: &str) -> Option<ComickChapter> {
    let hid = value["hid"].as_str().filter(|hid| valid_opaque(hid))?;
    let lang = value["lang"]
        .as_str()
        .filter(|lang| !lang.trim().is_empty())
        .unwrap_or(fallback_lang);
    if !valid_opaque(lang) {
        return None;
    }
    Some(ComickChapter {
        id: format!("comick:{hid}"),
        chapter: string_or_number(&value["chapter"]),
        lang: lang.to_owned(),
        title: value["title"].as_str().unwrap_or_default().to_owned(),
        publish_at: value["published_at"]
            .as_str()
            .or(value["publish_at"].as_str())
            .or(value["created_at"].as_str())
            .unwrap_or_default()
            .to_owned(),
        group: value["group"]
            .as_str()
            .or(value["groups"][0]["title"].as_str())
            .unwrap_or_default()
            .to_owned(),
    })
}

fn page_urls_from(images: &[Value]) -> Result<Vec<String>, Err> {
    images.iter().map(image_url).collect()
}

fn image_url(image: &Value) -> Result<String, Err> {
    if let Some(url) = image["url"].as_str().or(image["optimized"].as_str()) {
        let parsed = reqwest::Url::parse(url).map_err(|_| upstream_err())?;
        if parsed.scheme() != "https"
            || parsed.host_str() != Some(CDN_HOST)
            || parsed.port_or_known_default() != Some(443)
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(upstream_err());
        }
        return Ok(parsed.to_string());
    }
    let key = image["b2key"]
        .as_str()
        .filter(|key| valid_opaque(key) && !key.contains('/') && !key.contains(".."))
        .ok_or_else(upstream_err)?;
    Ok(format!("{CDN}/{key}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn comick_id_requires_prefix_and_nonempty_opaque_id() {
        assert!(is_comick_chapter_id("comick:abc123"));
        for invalid in ["abc123", "comick:", "comick:bad id", ""] {
            assert!(!is_comick_chapter_id(invalid), "accepted {invalid:?}");
        }
    }

    #[test]
    fn comick_id_rejects_path_delimiters_like_ts_parse_content_id() {
        assert!(is_comick_chapter_id("comick:abc123"));
        for invalid in ["comick:bad/id", "comick:bad?id", "comick:bad#id"] {
            assert!(!is_comick_chapter_id(invalid), "accepted {invalid:?}");
        }
    }

    #[test]
    fn comick_manga_id_requires_prefix_and_nonempty_opaque_id() {
        assert!(is_comick_manga_id("comick:comic-1"));
        for invalid in ["comic-1", "comick:", "comick:bad/id", ""] {
            assert!(!is_comick_manga_id(invalid), "accepted {invalid:?}");
        }
    }

    #[test]
    fn comick_detail_normalizes_official_comic_envelope() {
        let body = json!({
            "comic": {
                "hid": "comic-1",
                "title": "Comick Detail",
                "desc": "detail description",
                "status": 2,
                "year": 2024,
                "md_covers": [{ "b2key": "cover.jpg" }],
                "md_comic_md_genres": [
                    { "md_genres": { "slug": "action", "name": "Action" } }
                ],
                "bayesian_rating": "8.5",
                "user_follow_count": 99,
                "last_chapter": 3
            }
        });
        let dto = normalize_detail(&body).expect("valid comic detail");
        assert_eq!(dto.id.as_str(), "comick:comic-1");
        assert_eq!(dto.title, "Comick Detail");
        assert_eq!(dto.description, "detail description");
        assert_eq!(dto.status, "completed");
        assert_eq!(dto.tags, ["action"]);
        assert_eq!(dto.source_label, "Comick");
        assert_eq!(comic_path(dto.id.as_str()).unwrap(), "/v1.0/comic/comic%2D1/");
        assert!(normalize_detail(&json!({})).is_err());
    }

    #[test]
    fn comick_chapter_normalizes_missing_title_and_language() {
        let value = json!({
            "hid": "chap-1",
            "chapter": "7.5",
            "lang": "vi",
            "title": null
        });
        let chapter = chapter_from_value(&value, "en").expect("valid chapter");
        assert_eq!(chapter.id, "comick:chap-1");
        assert_eq!(chapter.chapter.as_deref(), Some("7.5"));
        assert_eq!(chapter.lang, "vi");
        assert_eq!(chapter.title, "");

        let missing_lang = chapter_from_value(
            &json!({ "hid": "chap-2", "chapter": 8, "lang": null, "title": "" }),
            "en",
        )
        .expect("missing language uses the requested language");
        assert_eq!(missing_lang.id, "comick:chap-2");
        assert_eq!(missing_lang.chapter.as_deref(), Some("8"));
        assert_eq!(missing_lang.lang, "en");
        assert_eq!(missing_lang.title, "");
        assert!(chapter_from_value(&json!({ "lang": "vi" }), "en").is_none());
    }

    #[test]
    fn comick_page_urls_are_https_and_ordered() {
        let urls = page_urls_from(&[json!({ "b2key": "a.jpg" }), json!({ "b2key": "b.jpg" })])
            .expect("valid image metadata");
        assert_eq!(urls, vec![format!("{CDN}/a.jpg"), format!("{CDN}/b.jpg")]);

        for bad in [
            json!({ "b2key": "a.jpg", "url": "http://meo.comick.pictures/a.jpg" }),
            json!({ "b2key": "a.jpg", "url": "https://evil.example/a.jpg" }),
        ] {
            assert!(page_urls_from(&[bad]).is_err(), "accepted unsafe image URL");
        }
    }

    #[test]
    fn comick_search_path_encodes_filters() {
        let path = search_path("slime & 100%", "vi", Some(2024), 2).expect("valid filters");
        assert!(path.starts_with("/v1.0/search/?q=slime%20%26%20100%25"));
        assert!(path.contains("&page=2"));
        assert!(path.contains("&limit=15"));
        // Official /v1.0/search/ has no `lang` filter; `from`/`to` are the year filters.
        assert!(path.contains("&from=2024&to=2024"));
        assert!(!path.contains("lang="));
        assert_eq!(
            path.matches('&').count(),
            4,
            "unexpected query params: {path}"
        );
        assert!(search_path("slime", "vi", None, 51).is_err());
        assert!(search_path("slime", "", None, 1).is_err());
    }

    #[test]
    fn comick_search_path_allows_browse_without_query() {
        let path = search_path("", "all", Some(2024), 2).expect("browse without q");
        assert_eq!(path, "/v1.0/search/?page=2&limit=15&from=2024&to=2024");
        let blank = search_path("   ", "all", None, 1).expect("blank q is omitted");
        assert_eq!(blank, "/v1.0/search/?page=1&limit=15");
    }

    #[test]
    fn comick_search_hit_sets_source_pair() {
        let hit = json!({
            "hid": "zZc_AAsE",
            "title": "Slime Slayer",
            "desc": "A slime story.",
            "year": 2024,
            "status": 1,
            "genres": [30, 244],
            "md_covers": [{ "b2key": "cover.jpg" }],
            "bayesian_rating": "7.11",
            "user_follow_count": 14253,
            "last_chapter": 20.1
        });
        let dto = normalize_search_hit(&hit).expect("valid search hit");
        assert_eq!(dto.id.as_str(), "comick:zZc_AAsE");
        assert_eq!(request_opaque(dto.id.as_str()), Some("zZc_AAsE"));
        assert_eq!(dto.title, "Slime Slayer");
        assert_eq!(dto.source, "comick");
        assert_eq!(dto.source_label, "Comick");
        assert_eq!(
            dto.cover_file.as_deref(),
            Some("https://meo.comick.pictures/cover.jpg")
        );
        assert_eq!(dto.year, Some(2024));
        assert_eq!(dto.status, "ongoing");
        assert_eq!(dto.tags, ["30", "244"]);
        assert_eq!(dto.tag_ids, ["30", "244"]);
        assert_eq!(dto.rating, Some(7.11));
        assert_eq!(dto.follows, Some(14_253));
        assert_eq!(dto.latest_chapter.as_deref(), Some("20.1"));
    }

    #[test]
    fn comick_search_hit_rejects_missing_title_or_id() {
        for hit in [
            json!({ "title": "Slime" }),
            json!({ "hid": "zZc_AAsE" }),
            json!({ "hid": "zZc_AAsE", "title": "" }),
            json!({ "hid": "bad/hid", "title": "Slime" }),
        ] {
            assert_eq!(
                normalize_search_hit(&hit).unwrap_err(),
                UPSTREAM_ERR,
                "accepted incomplete hit: {hit}"
            );
        }
    }
}
