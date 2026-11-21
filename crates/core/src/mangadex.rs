use contracts::{
    ChapterDto, ChapterFeedPage, ChaptersResponse, LatestChapterDto, LatestMangaDto,
    MangaSummaryDto, PagesResponse, SearchResponse, TagDto,
};
use moka::future::Cache;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

const API: &str = "https://api.mangadex.org";
const LIST_PARAMS: &str = "&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true";
/// MangaDex rejects offset + limit above 10,000 for collection endpoints.
const UPSTREAM_OFFSET_LIMIT: u32 = 10_000;
const NOTIFICATION_FEED_MAX: u32 = 500;

#[derive(Clone)]
pub struct Md {
    pub http: reqwest::Client,
    api: String,
    popular: Cache<(), Arc<Vec<MangaSummaryDto>>>,
    latest: Cache<(), Arc<Vec<LatestMangaDto>>>,
    search: Cache<String, Arc<SearchResponse>>,
    manga: Cache<String, Arc<MangaSummaryDto>>,
    chapters: Cache<String, Arc<ChaptersResponse>>,
    tags: Cache<(), Arc<Vec<TagDto>>>,
    ranks: Cache<String, Arc<Vec<MangaSummaryDto>>>,
}

type Err = String;

fn api_err(e: impl std::fmt::Display) -> Err {
    e.to_string()
}

impl Md {
    pub fn new(http: reqwest::Client) -> Self {
        // Local fixture override for the Next -> Axum topology tests. Production
        // keeps the upstream MangaDex origin unless this is explicitly set.
        let api = std::env::var("MANGADEX_API_ORIGIN")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| API.to_owned());
        Self {
            http,
            api,
            popular: Cache::builder()
                .time_to_live(Duration::from_secs(60))
                .max_capacity(1)
                .build(),
            latest: Cache::builder()
                .time_to_live(Duration::from_secs(60))
                .max_capacity(1)
                .build(),
            search: Cache::builder()
                .time_to_live(Duration::from_secs(60))
                .max_capacity(256)
                .build(),
            manga: Cache::builder()
                .time_to_live(Duration::from_secs(3600))
                .max_capacity(512)
                .build(),
            chapters: Cache::builder()
                .time_to_live(Duration::from_secs(60))
                .max_capacity(512)
                .build(),
            tags: Cache::builder()
                .time_to_live(Duration::from_secs(86_400))
                .max_capacity(1)
                .build(),
            ranks: Cache::builder()
                .time_to_live(Duration::from_secs(300))
                .max_capacity(2)
                .build(),
        }
    }

    async fn get(&self, path: &str) -> Result<Value, Err> {
        let res = self
            .http
            .get(format!("{}{path}", self.api))
            .send()
            .await
            .map_err(api_err)?;
        let status = res.status();
        if !status.is_success() {
            return Err(if status.as_u16() == 429 {
                "MangaDex giới hạn truy cập, vui lòng thử lại sau ít giây.".into()
            } else {
                format!("Không gọi được API MangaDex (mã {}).", status.as_u16())
            });
        }
        res.json::<Value>().await.map_err(api_err)
    }

    pub async fn popular(&self) -> Result<Arc<Vec<MangaSummaryDto>>, Err> {
        let md = self.clone();
        self.popular
            .try_get_with((), async move {
                let j = md
                    .get(&format!(
                        "/manga?limit=18&offset=0{LIST_PARAMS}&order[followedCount]=desc"
                    ))
                    .await?;
                Ok(Arc::new(summaries(&j)))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    /// Chapter feed = only manga with real readable pages in vi/en.
    pub async fn latest(&self) -> Result<Arc<Vec<LatestMangaDto>>, Err> {
        let md = self.clone();
        self.latest
            .try_get_with((), async move {
                let feed = md
                    .get("/chapter?limit=100&order[readableAt]=desc&translatedLanguage[]=vi&translatedLanguage[]=en")
                    .await?;
                let groups = latest_groups(&feed);
                if groups.is_empty() {
                    return Ok(Arc::new(Vec::new()));
                }
                let query = groups.iter().map(|(id, _)| format!("ids[]={id}")).collect::<Vec<_>>().join("&");
                let j = md.get(&format!("/manga?limit=18{LIST_PARAMS}&{query}")).await?;
                let ordered: Vec<_> = groups.into_iter().filter_map(|(id, chapters)| {
                    Some(LatestMangaDto {
                        manga: summary(items(&j).iter().find(|m| m["id"] == id)?)?,
                        chapters,
                    })
                }).collect();
                Ok(Arc::new(ordered))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    pub async fn tags(&self) -> Result<Arc<Vec<TagDto>>, Err> {
        self.tags
            .try_get_with((), async {
                let data = self.get("/manga/tag").await?;
                let tags = items(&data).iter().filter_map(tag_dto).collect();
                Ok(Arc::new(tags))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    pub async fn search_filtered(
        &self,
        q: &str,
        page: u32,
        tags: &[String],
        status: Option<&str>,
        sort: &str,
    ) -> Result<Arc<SearchResponse>, Err> {
        let path = search_path(q, page, tags, status, sort).ok_or("Bộ lọc không hợp lệ.")?;
        let md = self.clone();
        self.search
            .try_get_with(path.clone(), async move {
                let j = md.get(&path).await?;
                let (mut results, chapters) =
                    futures::join!(md.with_stats(&j), md.search_chapters(&j));
                for result in &mut results {
                    let Some(manga) = items(&j)
                        .iter()
                        .find(|manga| manga["id"].as_str() == Some(result.id.as_str()))
                    else {
                        continue;
                    };
                    if let Some(id) = manga["attributes"]["latestUploadedChapter"].as_str() {
                        if let Some(chapter) = items(&chapters).iter().find(|c| c["id"] == id) {
                            result.latest_chapter =
                                chapter["attributes"]["chapter"].as_str().map(str::to_owned);
                        }
                    }
                }
                Ok(Arc::new(SearchResponse {
                    results,
                    total: j["total"].as_u64().unwrap_or(0),
                }))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    async fn search_chapters(&self, manga: &Value) -> Value {
        let ids = items(manga)
            .iter()
            .filter_map(|m| m["attributes"]["latestUploadedChapter"].as_str())
            .map(|id| format!("ids[]={}", utf8_percent_encode(id, NON_ALPHANUMERIC)))
            .collect::<Vec<_>>()
            .join("&");
        if ids.is_empty() {
            return Value::Null;
        }
        self.get(&format!(
            "/chapter?limit=24&translatedLanguage[]=vi&translatedLanguage[]=en&{ids}"
        ))
        .await
        .unwrap_or_default()
    }

    pub async fn rank(&self, kind: &str) -> Result<Arc<Vec<MangaSummaryDto>>, Err> {
        let order = sort_param(kind).ok_or("Kiểu xếp hạng không hợp lệ.")?;
        self.ranks
            .try_get_with(kind.to_owned(), async {
                let data = self
                    .get(&format!("/manga?limit=24{LIST_PARAMS}&{order}"))
                    .await?;
                Ok(Arc::new(self.with_stats(&data).await))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    async fn stats(&self, ids: impl Iterator<Item = &str>) -> Result<Value, Err> {
        let query = ids
            .map(|id| format!("manga[]={}", utf8_percent_encode(id, NON_ALPHANUMERIC)))
            .collect::<Vec<_>>()
            .join("&");
        if query.is_empty() {
            return Ok(Value::Null);
        }
        self.get(&format!("/statistics/manga?{query}")).await
    }

    async fn with_stats(&self, data: &Value) -> Vec<MangaSummaryDto> {
        let stats = self
            .stats(items(data).iter().filter_map(|m| m["id"].as_str()))
            .await
            .unwrap_or_default();
        items(data)
            .iter()
            .filter_map(|m| summary_with_stats(m, &stats))
            .collect()
    }

    pub async fn manga(&self, id: &str) -> Result<Arc<MangaSummaryDto>, Err> {
        let id = id.to_string();
        let md = self.clone();
        self.manga
            .try_get_with(id.clone(), async move {
                let path = format!("/manga/{id}?{LIST_PARAMS}");
                let (manga, stats) =
                    futures::join!(md.get(&path), md.stats(std::iter::once(id.as_str())));
                let manga = manga?;
                let summary = summary_with_stats(&manga["data"], &stats.unwrap_or_default())
                    .ok_or_else(|| "MangaDex returned manga without a valid id.".to_owned())?;
                Ok(Arc::new(summary))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    /// Both languages in one round trip (server joins in parallel).
    pub async fn chapters(&self, id: &str) -> Result<Arc<ChaptersResponse>, Err> {
        let id = id.to_string();
        let md = self.clone();
        self.chapters
            .try_get_with(id.clone(), async move {
                let (vi, en) = futures::join!(md.feed(&id, "vi"), md.feed(&id, "en"));
                Ok(Arc::new(ChaptersResponse { vi: vi?, en: en? }))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    /// Notification-only feed. Publish-time ordering plus an explicit offset
    /// continuation reaches chapters past the public list's 2000-item cap.
    /// `since` is an exclusive ISO publishAt lower bound; `None` asks for the
    /// newest available publications (first-observation baseline).
    pub async fn notification_feed(
        &self,
        id: &str,
        lang: &str,
        since: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<ChapterFeedPage, Err> {
        if !matches!(lang, "vi" | "en")
            || limit == 0
            || limit > NOTIFICATION_FEED_MAX
            || offset.saturating_add(limit) > UPSTREAM_OFFSET_LIMIT
            || since.is_some_and(|value| {
                value.len() > 30
                    || !value
                        .chars()
                        .all(|c| c.is_ascii_digit() || "-:.TZ".contains(c))
            })
        {
            return Err("Tham số feed thông báo không hợp lệ.".into());
        }
        let j = self
            .get(&notification_feed_path(id, lang, since, offset, limit))
            .await?;
        let total = j["total"].as_u64().unwrap_or(0);
        let raw = j["data"].as_array().cloned().unwrap_or_default();
        let mut items: Vec<ChapterDto> = raw
            .iter()
            .filter_map(|chapter| chapter_dto_publish(chapter, lang))
            .collect();
        // Upstream does not guarantee id order inside one publish timestamp.
        items.sort_by(|a, b| {
            a.publish_at
                .cmp(&b.publish_at)
                .then_with(|| a.id.as_str().cmp(b.id.as_str()))
        });
        let next_offset = if offset.saturating_add(limit) < UPSTREAM_OFFSET_LIMIT
            && (offset as u64) + (items.len() as u64) < total
        {
            Some(offset + limit)
        } else {
            None
        };
        let partial = total > UPSTREAM_OFFSET_LIMIT as u64
            && (offset as u64) + (limit as u64) >= UPSTREAM_OFFSET_LIMIT as u64;
        Ok(ChapterFeedPage {
            items,
            total,
            offset,
            limit,
            next_offset,
            partial,
        })
    }

    async fn feed(&self, id: &str, lang: &str) -> Result<Vec<ChapterDto>, Err> {
        let mut raw: Vec<Value> = Vec::new();
        let mut offset = 0u32;
        let mut total = u64::MAX;
        // feeds paginate at 500; cap at 2000 chapters per manga
        while (offset as u64) < total && offset < 2000 {
            let j = self
                .get(&format!(
                    "/manga/{id}/feed?limit=500&offset={offset}&translatedLanguage[]={lang}&order[chapter]=asc&includes[]=scanlation_group"
                ))
                .await?;
            total = j["total"].as_u64().unwrap_or(0);
            if let Some(arr) = j["data"].as_array() {
                raw.extend(arr.iter().cloned());
            }
            offset += 500;
        }
        let mut seen = std::collections::HashSet::new();
        let mut out: Vec<ChapterDto> = Vec::new();
        for c in raw {
            let Some(chapter) = chapter_dto(&c, lang) else {
                continue;
            };
            let key = chapter.chapter.as_deref().unwrap_or("oneshot").to_owned();
            if !seen.insert(key) {
                continue; // first scanlation wins
            }
            out.push(chapter);
        }
        out.sort_by(|a, b| {
            let num = |v: &ChapterDto| {
                v.chapter
                    .as_deref()
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0)
            };
            num(a)
                .partial_cmp(&num(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(out)
    }

    /// At-home URLs are short-lived: never cache. Returns same-origin proxy paths.
    pub async fn pages(&self, chapter_id: &str) -> Result<PagesResponse, Err> {
        let j = self.get(&format!("/at-home/server/{chapter_id}")).await?;
        let ch = &j["chapter"];
        let (directory, files) = if ch["data"].as_array().is_some_and(|a| !a.is_empty()) {
            ("data", &ch["data"])
        } else {
            ("data-saver", &ch["dataSaver"])
        };
        let base = j["baseUrl"].as_str().unwrap_or("");
        let hash = ch["hash"].as_str().unwrap_or("");
        let pages: Vec<String> = files
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|f| f.as_str())
            .map(|f| {
                let url = format!("{base}/{directory}/{hash}/{f}");
                image_proxy_path(&url)
            })
            .collect();
        Ok(PagesResponse { pages })
    }
}

/// New page URLs target the content namespace; legacy `/api/img` stays registered
/// on the Axum server for the old Leptos client and as a forwarding alias in Next.
fn image_proxy_path(url: &str) -> String {
    format!(
        "/api/content/img?u={}",
        utf8_percent_encode(url, NON_ALPHANUMERIC)
    )
}

fn pick(map: &Value) -> String {
    for key in ["en", "ja-ro", "vi", "ja"] {
        if let Some(s) = map[key].as_str() {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    map.as_object()
        .and_then(|o| o.values().next())
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn tag_dto(tag: &Value) -> Option<TagDto> {
    let id = tag["id"].as_str().filter(|id| !id.trim().is_empty())?;
    Some(TagDto {
        id: id.to_owned(),
        name: pick(&tag["attributes"]["name"]),
        group: tag["attributes"]["group"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
    })
}

fn notification_feed_path(
    id: &str,
    lang: &str,
    since: Option<&str>,
    offset: u32,
    limit: u32,
) -> String {
    let order = if since.is_some() { "asc" } else { "desc" };
    let mut path = format!(
        "/chapter?limit={limit}&offset={offset}&manga={id}&translatedLanguage[]={lang}&order[publishAt]={order}"
    );
    if let Some(since) = since {
        let encoded = utf8_percent_encode(since, NON_ALPHANUMERIC);
        path.push_str(&format!("&publishAtSince={encoded}"));
    }
    path
}

fn chapter_dto(chapter: &Value, lang: &str) -> Option<ChapterDto> {
    chapter_dto_impl(chapter, lang, false)
}

fn chapter_dto_publish(chapter: &Value, lang: &str) -> Option<ChapterDto> {
    chapter_dto_impl(chapter, lang, true)
}

fn chapter_dto_impl(chapter: &Value, lang: &str, publish_first: bool) -> Option<ChapterDto> {
    let id = chapter["id"].as_str().filter(|id| !id.trim().is_empty())?;
    let attributes = &chapter["attributes"];
    let group = chapter["relationships"]
        .as_array()
        .map(|relationships| {
            relationships
                .iter()
                .filter(|relationship| relationship["type"] == "scanlation_group")
                .filter_map(|relationship| relationship["attributes"]["name"].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    Some(ChapterDto {
        id: id.into(),
        chapter: attributes["chapter"].as_str().map(str::to_owned),
        volume: attributes["volume"].as_str().map(str::to_owned),
        title: attributes["title"].as_str().unwrap_or_default().to_owned(),
        lang: attributes["translatedLanguage"]
            .as_str()
            .unwrap_or(lang)
            .to_owned(),
        pages: attributes["pages"].as_u64().unwrap_or(0),
        external_url: attributes["externalUrl"].as_str().map(str::to_owned),
        publish_at: if publish_first {
            attributes["publishAt"]
                .as_str()
                .or(attributes["readableAt"].as_str())
        } else {
            attributes["readableAt"]
                .as_str()
                .or(attributes["publishAt"].as_str())
        }
        .unwrap_or_default()
        .to_owned(),
        group,
    })
}

fn summary(m: &Value) -> Option<MangaSummaryDto> {
    let id = m["id"].as_str().filter(|id| !id.trim().is_empty())?;
    let a = &m["attributes"];
    let rels = m["relationships"].as_array().cloned().unwrap_or_default();
    let cover = rels
        .iter()
        .find(|r| r["type"] == "cover_art")
        .and_then(|r| r["attributes"]["fileName"].as_str())
        .map(String::from);
    let names: Vec<String> = rels
        .iter()
        .filter(|r| r["type"] == "author" || r["type"] == "artist")
        .filter_map(|r| r["attributes"]["name"].as_str().map(String::from))
        .collect();
    let mut title = pick(&a["title"]);
    if title.is_empty() {
        title = a["altTitles"]
            .as_array()
            .and_then(|alts| alts.iter().map(pick).find(|t| !t.is_empty()))
            .unwrap_or_else(|| "Không rõ".into());
    }
    Some(MangaSummaryDto {
        id: id.into(),
        title,
        cover_file: cover,
        status: a["status"].as_str().unwrap_or_default().to_owned(),
        year: a["year"].as_i64().and_then(|year| i32::try_from(year).ok()),
        description: pick(&a["description"]),
        tags: a["tags"]
            .as_array()
            .map(|ts| {
                ts.iter()
                    .map(|t| pick(&t["attributes"]["name"]))
                    .filter(|t| !t.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        tag_ids: a["tags"]
            .as_array()
            .map(|ts| {
                ts.iter()
                    .filter_map(|t| {
                        t["id"]
                            .as_str()
                            .filter(|id| !id.trim().is_empty())
                            .map(str::to_owned)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        author: if names.len() > 1 {
            names.last().cloned().unwrap_or_default()
        } else {
            names.first().cloned().unwrap_or_default()
        },
        artist: names.first().cloned().unwrap_or_default(),
        rating: None,
        follows: None,
        latest_chapter: None,
    })
}

fn items(data: &Value) -> &[Value] {
    data["data"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn summaries(j: &Value) -> Vec<MangaSummaryDto> {
    items(j).iter().filter_map(summary).collect()
}

fn summary_with_stats(manga: &Value, stats: &Value) -> Option<MangaSummaryDto> {
    let mut item = summary(manga)?;
    if let Some(id) = manga["id"].as_str() {
        let stats = &stats["statistics"][id];
        item.rating = stats["rating"]["bayesian"].as_f64();
        item.follows = stats["follows"].as_u64();
    }
    Some(item)
}

/// Shared identifier guard for content handlers on both API namespaces.
pub fn is_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

pub fn sort_param(sort: &str) -> Option<&'static str> {
    Some(match sort {
        "follows" => "order[followedCount]=desc",
        "rating" => "order[rating]=desc",
        "new" => "order[latestUploadedChapter]=desc",
        "year" => "order[year]=desc",
        "title" => "order[title]=asc",
        _ => return None,
    })
}

pub fn status_param(status: &str) -> Option<&'static str> {
    Some(match status {
        "ongoing" => "ongoing",
        "completed" => "completed",
        "hiatus" => "hiatus",
        "cancelled" => "cancelled",
        _ => return None,
    })
}

fn search_path(
    q: &str,
    page: u32,
    tags: &[String],
    status: Option<&str>,
    sort: &str,
) -> Option<String> {
    let offset = page.saturating_sub(1).checked_mul(24)?;
    let mut path = format!("/manga?limit=24&offset={offset}");
    if !q.is_empty() {
        path.push_str(&format!(
            "&title={}",
            utf8_percent_encode(q, NON_ALPHANUMERIC)
        ));
    }
    path.push_str(LIST_PARAMS);
    path.push('&');
    path.push_str(sort_param(sort)?);
    if let Some(status) = status {
        path.push_str(&format!("&status[]={}", status_param(status)?));
    }
    for tag in tags {
        path.push_str(&format!(
            "&includedTags[]={}",
            utf8_percent_encode(tag, NON_ALPHANUMERIC)
        ));
    }
    Some(path)
}

fn latest_groups(feed: &Value) -> Vec<(&str, Vec<LatestChapterDto>)> {
    let mut groups: Vec<(&str, Vec<LatestChapterDto>)> = Vec::new();
    for chapter in items(feed) {
        let attributes = &chapter["attributes"];
        let Some(id) = chapter["id"].as_str().filter(|id| !id.trim().is_empty()) else {
            continue;
        };
        if attributes["pages"].as_u64().unwrap_or(0) == 0 || !attributes["externalUrl"].is_null() {
            continue;
        }
        let Some(manga) = chapter["relationships"]
            .as_array()
            .and_then(|relationships| relationships.iter().find(|r| r["type"] == "manga"))
            .and_then(|r| r["id"].as_str())
        else {
            continue;
        };
        let index = match groups.iter().position(|(id, _)| *id == manga) {
            Some(index) => index,
            None if groups.len() < 18 => {
                groups.push((manga, Vec::new()));
                groups.len() - 1
            }
            None => continue,
        };
        let list = &mut groups[index].1;
        if list.len() < 3 && !list.iter().any(|c| c.id.as_str() == id) {
            list.push(LatestChapterDto {
                id: id.into(),
                chapter: attributes["chapter"].as_str().map(str::to_owned),
                lang: attributes["translatedLanguage"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                publish_at: attributes["readableAt"]
                    .as_str()
                    .or(attributes["publishAt"].as_str())
                    .unwrap_or_default()
                    .to_owned(),
            });
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn page_image_urls_use_the_content_namespace() {
        let path = image_proxy_path("https://uploads.mangadex.org/data/hash/1.png");
        assert!(path.starts_with("/api/content/img?u="));
        assert!(path.contains("%2Fdata%2Fhash%2F1"));
        assert!(!path.starts_with("/api/img"));
    }

    #[test]
    fn content_ids_are_uuids_and_never_opaque_auth_ids() {
        assert!(is_uuid("391b0423-d847-456f-aff0-8b0cfc03066b"));
        for bad in [
            "not-a-uuid",
            "google|opaque",
            "",
            "391b0423d847456faff08b0cfc03066b",
        ] {
            assert!(!is_uuid(bad), "{bad}");
        }
    }

    #[test]
    fn catalog_filters_use_known_upstream_values() {
        for (sort, upstream) in [
            ("follows", "order[followedCount]=desc"),
            ("rating", "order[rating]=desc"),
            ("new", "order[latestUploadedChapter]=desc"),
            ("year", "order[year]=desc"),
            ("title", "order[title]=asc"),
        ] {
            assert_eq!(sort_param(sort), Some(upstream));
        }
        for status in ["ongoing", "completed", "hiatus", "cancelled"] {
            assert_eq!(status_param(status), Some(status));
        }
        assert_eq!(sort_param("bad"), None);
        assert_eq!(status_param("bad"), None);
        let path = search_path(
            "a&b",
            2,
            &["test-a".into(), "test-b".into()],
            Some("completed"),
            "title",
        )
        .unwrap();
        assert!(path.contains("offset=24&title=a%26b"));
        assert!(path.contains("status[]=completed&includedTags[]=test%2Da&includedTags[]=test%2Db"));
    }

    #[test]
    fn manga_projection_keeps_summary_fields_and_adds_stats() {
        let manga = json!({
            "id": "manga-id",
            "attributes": {
                "title": {"en": "Title"},
                "status": "ongoing",
                "year": 2024,
                "description": {"en": "Description"},
                "tags": [{"id": "tag-id", "attributes": {"name": {"en": "Action"}}}]
            },
            "relationships": [
                {"type": "cover_art", "attributes": {"fileName": "cover.jpg"}},
                {"type": "author", "attributes": {"name": "Author"}}
            ]
        });
        let stats = json!({"statistics": {"manga-id": {
            "rating": {"bayesian": 8.5}, "follows": 42
        }}});
        let encoded = serde_json::to_value(summary_with_stats(&manga, &stats).unwrap()).unwrap();
        assert_eq!(encoded["id"], "manga-id");
        assert_eq!(encoded["title"], "Title");
        assert_eq!(encoded["cover_file"], "cover.jpg");
        assert_eq!(encoded["year"], 2024);
        assert_eq!(encoded["tags"], json!(["Action"]));
        assert_eq!(encoded["tag_ids"], json!(["tag-id"]));
        assert_eq!(encoded["rating"], 8.5);
        assert_eq!(encoded["follows"], 42);
    }

    #[test]
    fn tag_conversion_rejects_missing_non_string_and_empty_ids() {
        for record in [
            json!({}),
            json!({"id": 7}),
            json!({"id": ""}),
            json!({"id": "   "}),
        ] {
            assert!(tag_dto(&record).is_none());
        }
    }

    #[test]
    fn chapter_conversion_rejects_missing_non_string_and_empty_ids() {
        for record in [
            json!({}),
            json!({"id": 7}),
            json!({"id": ""}),
            json!({"id": "   "}),
        ] {
            assert!(chapter_dto(&record, "vi").is_none());
        }
    }

    #[test]
    fn latest_chapter_conversion_never_emits_empty_ids() {
        let attributes = json!({
            "pages": 1,
            "externalUrl": null,
            "translatedLanguage": "vi"
        });
        let relationship = json!([{"type": "manga", "id": "manga-id"}]);
        let chapter = |id: Value| {
            json!({
                "id": id,
                "attributes": attributes,
                "relationships": relationship
            })
        };
        let mut missing_id = chapter(Value::Null);
        missing_id.as_object_mut().unwrap().remove("id");
        let feed = json!({
            "data": [missing_id, chapter(json!(7)), chapter(json!("")), chapter(json!("   "))]
        });

        let groups = latest_groups(&feed);

        assert!(groups
            .iter()
            .flat_map(|(_, chapters)| chapters)
            .all(|chapter| !chapter.id.as_str().trim().is_empty()));
    }

    #[test]
    fn manga_summary_conversion_rejects_missing_non_string_and_empty_ids() {
        for record in [
            json!({}),
            json!({"id": 7}),
            json!({"id": ""}),
            json!({"id": "   "}),
        ] {
            assert!(summary(&record).is_none());
        }
    }

    #[test]
    fn manga_summary_skips_empty_tag_ids_but_keeps_tag_names() {
        let manga = json!({
            "id": "manga-id",
            "attributes": {
                "title": {"en": "Title"},
                "tags": [
                    {"id": "tag-a", "attributes": {"name": {"en": "Action"}}},
                    {"id": "", "attributes": {"name": {"en": "Empty"}}},
                    {"id": "   ", "attributes": {"name": {"en": "Blank"}}},
                    {"id": 7, "attributes": {"name": {"en": "Non-string"}}}
                ]
            }
        });
        let encoded = serde_json::to_value(summary(&manga).unwrap()).unwrap();
        assert_eq!(encoded["tag_ids"], json!(["tag-a"]));
        assert_eq!(
            encoded["tags"],
            json!(["Action", "Empty", "Blank", "Non-string"])
        );
    }

    #[test]
    fn notification_feed_path_uses_publish_order_and_encoded_continuation() {
        let baseline = notification_feed_path("m1", "vi", None, 0, 100);
        assert_eq!(
            baseline,
            "/chapter?limit=100&offset=0&manga=m1&translatedLanguage[]=vi&order[publishAt]=desc"
        );
        let resumed = notification_feed_path("m1", "en", Some("2026-07-01T00:00:00Z"), 300, 100);
        assert_eq!(
            resumed,
            "/chapter?limit=100&offset=300&manga=m1&translatedLanguage[]=en&order[publishAt]=asc&publishAtSince=2026%2D07%2D01T00%3A00%3A00Z"
        );
    }

    #[test]
    fn notification_feed_dto_uses_publish_at_not_readable_at() {
        let chapter = json!({
            "id": "c1",
            "attributes": {
                "publishAt": "2026-07-01T00:00:00Z",
                "readableAt": "2026-07-02T00:00:00Z",
                "translatedLanguage": "vi",
                "pages": 1
            },
            "relationships": []
        });
        assert_eq!(
            chapter_dto_publish(&chapter, "vi").unwrap().publish_at,
            "2026-07-01T00:00:00Z"
        );
        assert_eq!(
            chapter_dto(&chapter, "vi").unwrap().publish_at,
            "2026-07-02T00:00:00Z",
            "the public list keeps its readableAt contract"
        );
    }

    #[test]
    fn latest_groups_only_readable_chapters_with_language() {
        let chapter = |id, pages, external, manga| {
            json!({
                "id": id, "attributes": {"pages": pages, "externalUrl": external,
                "translatedLanguage": "vi"}, "relationships": [{"type": "manga", "id": manga}]
            })
        };
        let feed = json!({"data": [chapter("c0", 1, Some("https://example.com"), "m0"),
            chapter("c1", 2, None, "m1"), chapter("c2", 2, None, "m1"),
            chapter("c3", 2, None, "m1"), chapter("c4", 2, None, "m1")]});
        let groups = latest_groups(&feed);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, "m1");
        assert_eq!(groups[0].1.len(), 3);
        assert_eq!(groups[0].1[0].lang, "vi");
    }
}
