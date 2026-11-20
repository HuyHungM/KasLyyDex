use moka::future::Cache;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

const API: &str = "https://api.mangadex.org";
const LIST_PARAMS: &str = "&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true";

#[derive(Clone)]
pub struct Md {
    pub http: reqwest::Client,
    lists: Cache<String, Arc<Value>>,
    manga: Cache<String, Arc<Value>>,
    chapters: Cache<String, Arc<Value>>,
    tags: Cache<(), Arc<Value>>,
    ranks: Cache<String, Arc<Value>>,
}

type Err = String;

fn api_err(e: impl std::fmt::Display) -> Err {
    e.to_string()
}

impl Md {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            lists: Cache::builder().time_to_live(Duration::from_secs(60)).max_capacity(256).build(),
            manga: Cache::builder().time_to_live(Duration::from_secs(3600)).max_capacity(512).build(),
            chapters: Cache::builder().time_to_live(Duration::from_secs(60)).max_capacity(512).build(),
            tags: Cache::builder().time_to_live(Duration::from_secs(86_400)).max_capacity(1).build(),
            ranks: Cache::builder().time_to_live(Duration::from_secs(300)).max_capacity(2).build(),
        }
    }

    async fn get(&self, path: &str) -> Result<Value, Err> {
        let res = self
            .http
            .get(format!("{API}{path}"))
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

    pub async fn popular(&self) -> Result<Arc<Value>, Err> {
        let md = self.clone();
        self.lists
            .try_get_with("popular".to_string(), async move {
                let j = md.get(&format!("/manga?limit=18&offset=0{LIST_PARAMS}&order[followedCount]=desc")).await?;
                Ok(Arc::new(summaries(&j)))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    /// Chapter feed = only manga with real readable pages in vi/en.
    pub async fn latest(&self) -> Result<Arc<Value>, Err> {
        let md = self.clone();
        self.lists
            .try_get_with("latest".to_string(), async move {
                let feed = md
                    .get("/chapter?limit=100&order[readableAt]=desc&translatedLanguage[]=vi&translatedLanguage[]=en")
                    .await?;
                let groups = latest_groups(&feed);
                if groups.is_empty() {
                    return Ok(Arc::new(json!([])));
                }
                let query = groups.iter().map(|(id, _)| format!("ids[]={id}")).collect::<Vec<_>>().join("&");
                let j = md.get(&format!("/manga?limit=18{LIST_PARAMS}&{query}")).await?;
                let ordered: Vec<_> = groups.into_iter().filter_map(|(id, chapters)| {
                    let mut manga = summary(items(&j).iter().find(|m| m["id"] == id)?);
                    manga["chapters"] = json!(chapters);
                    Some(manga)
                }).collect();
                Ok(Arc::new(json!(ordered)))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    pub async fn tags(&self) -> Result<Arc<Value>, Err> {
        self.tags.try_get_with((), async {
            let data = self.get("/manga/tag").await?;
            let tags: Vec<_> = items(&data).iter().map(|tag| json!({
                "id": tag["id"], "name": pick(&tag["attributes"]["name"]),
                "group": tag["attributes"]["group"],
            })).collect();
            Ok(Arc::new(json!(tags)))
        }).await.map_err(|e: Arc<Err>| (*e).clone())
    }

    pub async fn search_filtered(&self, q: &str, page: u32, tags: &[String], status: Option<&str>, sort: &str) -> Result<Arc<Value>, Err> {
        let path = search_path(q, page, tags, status, sort).ok_or("Bộ lọc không hợp lệ.")?;
        let md = self.clone();
        self.lists
            .try_get_with(path.clone(), async move {
                let j = md.get(&path).await?;
                let (mut results, chapters) = futures::join!(md.with_stats(&j), md.search_chapters(&j));
                for (result, manga) in results.iter_mut().zip(items(&j)) {
                    if let Some(id) = manga["attributes"]["latestUploadedChapter"].as_str() {
                        if let Some(chapter) = items(&chapters).iter().find(|c| c["id"] == id) {
                            result["latest_chapter"] = chapter["attributes"]["chapter"].clone();
                        }
                    }
                }
                Ok(Arc::new(json!({ "results": results, "total": j["total"].as_u64().unwrap_or(0) })))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    async fn search_chapters(&self, manga: &Value) -> Value {
        let ids = items(manga).iter().filter_map(|m| m["attributes"]["latestUploadedChapter"].as_str())
            .map(|id| format!("ids[]={}", utf8_percent_encode(id, NON_ALPHANUMERIC)))
            .collect::<Vec<_>>().join("&");
        if ids.is_empty() { return Value::Null; }
        self.get(&format!("/chapter?limit=24&translatedLanguage[]=vi&translatedLanguage[]=en&{ids}"))
            .await.unwrap_or_default()
    }

    pub async fn rank(&self, kind: &str) -> Result<Arc<Value>, Err> {
        let order = sort_param(kind).ok_or("Kiểu xếp hạng không hợp lệ.")?;
        self.ranks.try_get_with(kind.to_owned(), async {
            let data = self.get(&format!("/manga?limit=24{LIST_PARAMS}&{order}")).await?;
            Ok(Arc::new(json!(self.with_stats(&data).await)))
        }).await.map_err(|e: Arc<Err>| (*e).clone())
    }

    async fn stats(&self, ids: impl Iterator<Item = &str>) -> Result<Value, Err> {
        let query = ids.map(|id| format!("manga[]={}", utf8_percent_encode(id, NON_ALPHANUMERIC)))
            .collect::<Vec<_>>().join("&");
        if query.is_empty() {
            return Ok(Value::Null);
        }
        self.get(&format!("/statistics/manga?{query}")).await
    }

    async fn with_stats(&self, data: &Value) -> Vec<Value> {
        let stats = self.stats(items(data).iter().filter_map(|m| m["id"].as_str())).await.unwrap_or_default();
        items(data).iter().map(|m| summary_with_stats(m, &stats)).collect()
    }

    pub async fn manga(&self, id: &str) -> Result<Arc<Value>, Err> {
        let id = id.to_string();
        let md = self.clone();
        self.manga
            .try_get_with(id.clone(), async move {
                let path = format!("/manga/{id}?{LIST_PARAMS}");
                let (manga, stats) = futures::join!(md.get(&path), md.stats(std::iter::once(id.as_str())));
                Ok(Arc::new(summary_with_stats(&manga?["data"], &stats.unwrap_or_default())))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    /// Both languages in one round trip (server joins in parallel).
    pub async fn chapters(&self, id: &str) -> Result<Arc<Value>, Err> {
        let id = id.to_string();
        let md = self.clone();
        self.chapters
            .try_get_with(id.clone(), async move {
                let (vi, en) = futures::join!(md.feed(&id, "vi"), md.feed(&id, "en"));
                Ok(Arc::new(json!({ "vi": vi?, "en": en? })))
            })
            .await
            .map_err(|e: Arc<Err>| (*e).clone())
    }

    async fn feed(&self, id: &str, lang: &str) -> Result<Value, Err> {
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
        let mut out: Vec<Value> = Vec::new();
        for c in raw {
            let a = &c["attributes"];
            let key = a["chapter"].as_str().unwrap_or("oneshot").to_string();
            if !seen.insert(key) {
                continue; // first scanlation wins
            }
            let group = c["relationships"]
                .as_array()
                .map(|rs| {
                    rs.iter()
                        .filter(|r| r["type"] == "scanlation_group")
                        .filter_map(|r| r["attributes"]["name"].as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            out.push(json!({
                "id": c["id"],
                "chapter": a["chapter"],
                "volume": a["volume"],
                "title": a["title"].as_str().unwrap_or(""),
                "lang": a["translatedLanguage"].as_str().unwrap_or(lang),
                "pages": a["pages"].as_u64().unwrap_or(0),
                "external_url": a["externalUrl"],
                "publish_at": a["readableAt"].as_str().or(a["publishAt"].as_str()).unwrap_or(""),
                "group": group,
            }));
        }
        out.sort_by(|a, b| {
            let num = |v: &Value| v["chapter"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
            num(a).partial_cmp(&num(b)).unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(json!(out))
    }

    /// At-home URLs are short-lived: never cache. Returns same-origin proxy paths.
    pub async fn pages(&self, chapter_id: &str) -> Result<Value, Err> {
        let j = self.get(&format!("/at-home/server/{chapter_id}")).await?;
        let ch = &j["chapter"];
        let (directory, files) = if ch["data"].as_array().is_some_and(|a| !a.is_empty()) {
            ("data", &ch["data"])
        } else { ("data-saver", &ch["dataSaver"]) };
        let base = j["baseUrl"].as_str().unwrap_or("");
        let hash = ch["hash"].as_str().unwrap_or("");
        let pages: Vec<String> = files
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|f| f.as_str())
            .map(|f| {
                let url = format!("{base}/{directory}/{hash}/{f}");
                format!("/api/img?u={}", utf8_percent_encode(&url, NON_ALPHANUMERIC))
            })
            .collect();
        Ok(json!({ "pages": pages }))
    }
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

fn summary(m: &Value) -> Value {
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
    json!({
        "id": m["id"],
        "title": title,
        "cover_file": cover,
        "status": a["status"].as_str().unwrap_or(""),
        "year": a["year"],
        "description": pick(&a["description"]),
        "tags": a["tags"].as_array().map(|ts| ts.iter().map(|t| pick(&t["attributes"]["name"])).filter(|t| !t.is_empty()).collect::<Vec<_>>()).unwrap_or_default(),
        "tag_ids": a["tags"].as_array().map(|ts| ts.iter().filter_map(|t| t["id"].as_str()).collect::<Vec<_>>()).unwrap_or_default(),
        "author": if names.len() > 1 { names.last().cloned().unwrap_or_default() } else { names.first().cloned().unwrap_or_default() },
        "artist": names.first().cloned().unwrap_or_default(),
    })
}

fn items(data: &Value) -> &[Value] {
    data["data"].as_array().map(Vec::as_slice).unwrap_or_default()
}

fn summaries(j: &Value) -> Value {
    json!(items(j).iter().map(summary).collect::<Vec<_>>())
}

fn summary_with_stats(manga: &Value, stats: &Value) -> Value {
    let mut item = summary(manga);
    if let Some(id) = manga["id"].as_str() {
        let stats = &stats["statistics"][id];
        item["rating"] = stats["rating"]["bayesian"].clone();
        item["follows"] = stats["follows"].clone();
    }
    item
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

fn search_path(q: &str, page: u32, tags: &[String], status: Option<&str>, sort: &str) -> Option<String> {
    let offset = page.saturating_sub(1).checked_mul(24)?;
    let mut path = format!("/manga?limit=24&offset={offset}");
    if !q.is_empty() {
        path.push_str(&format!("&title={}", utf8_percent_encode(q, NON_ALPHANUMERIC)));
    }
    path.push_str(LIST_PARAMS);
    path.push('&');
    path.push_str(sort_param(sort)?);
    if let Some(status) = status {
        path.push_str(&format!("&status[]={}", status_param(status)?));
    }
    for tag in tags {
        path.push_str(&format!("&includedTags[]={}", utf8_percent_encode(tag, NON_ALPHANUMERIC)));
    }
    Some(path)
}

fn latest_groups(feed: &Value) -> Vec<(&str, Vec<Value>)> {
    let mut groups: Vec<(&str, Vec<Value>)> = Vec::new();
    for chapter in items(feed) {
        let attributes = &chapter["attributes"];
        let Some(id) = chapter["id"].as_str() else { continue };
        if attributes["pages"].as_u64().unwrap_or(0) == 0 || !attributes["externalUrl"].is_null() {
            continue;
        }
        let Some(manga) = chapter["relationships"].as_array()
            .and_then(|relationships| relationships.iter().find(|r| r["type"] == "manga"))
            .and_then(|r| r["id"].as_str()) else { continue };
        let index = match groups.iter().position(|(id, _)| *id == manga) {
            Some(index) => index,
            None if groups.len() < 18 => {
                groups.push((manga, Vec::new()));
                groups.len() - 1
            }
            None => continue,
        };
        let list = &mut groups[index].1;
        if list.len() < 3 && !list.iter().any(|c| c["id"] == id) {
            list.push(json!({"id": id, "chapter": attributes["chapter"],
                "lang": attributes["translatedLanguage"], "publish_at": attributes["readableAt"].as_str().or(attributes["publishAt"].as_str()).unwrap_or("")}));
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_filters_use_known_upstream_values() {
        for (sort, upstream) in [
            ("follows", "order[followedCount]=desc"), ("rating", "order[rating]=desc"),
            ("new", "order[latestUploadedChapter]=desc"), ("year", "order[year]=desc"),
            ("title", "order[title]=asc"),
        ] {
            assert_eq!(sort_param(sort), Some(upstream));
        }
        for status in ["ongoing", "completed", "hiatus", "cancelled"] {
            assert_eq!(status_param(status), Some(status));
        }
        assert_eq!(sort_param("bad"), None);
        assert_eq!(status_param("bad"), None);
        let path = search_path("a&b", 2, &["test-a".into(), "test-b".into()], Some("completed"), "title").unwrap();
        assert!(path.contains("offset=24&title=a%26b"));
        assert!(path.contains("status[]=completed&includedTags[]=test%2Da&includedTags[]=test%2Db"));
    }

    #[test]
    fn latest_groups_only_readable_chapters_with_language() {
        let chapter = |id, pages, external, manga| json!({
            "id": id, "attributes": {"pages": pages, "externalUrl": external,
            "translatedLanguage": "vi"}, "relationships": [{"type": "manga", "id": manga}]
        });
        let feed = json!({"data": [chapter("c0", 1, Some("https://example.com"), "m0"),
            chapter("c1", 2, None, "m1"), chapter("c2", 2, None, "m1"),
            chapter("c3", 2, None, "m1"), chapter("c4", 2, None, "m1")]});
        let groups = latest_groups(&feed);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, "m1");
        assert_eq!(groups[0].1.len(), 3);
        assert_eq!(groups[0].1[0]["lang"], "vi");
    }
}
