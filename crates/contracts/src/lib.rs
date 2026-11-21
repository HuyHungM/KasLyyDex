use domain::{ChapterId, MangaId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use domain::{
    Chapter, CultivationLevel, CultivationRealm, Manga, ReaderBackground, ReaderMode,
    ReaderSettings, ReadingProgress, SystemRole,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub details: BTreeMap<String, String>,
}

impl ApiError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: BTreeMap::new(),
        }
    }

    pub fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details.insert(key.into(), value.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApiErrorEnvelope {
    pub error: ApiError,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MangaSummaryDto {
    pub id: MangaId,
    pub title: String,
    pub cover_file: Option<String>,
    pub status: String,
    pub year: Option<i32>,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub author: String,
    pub artist: String,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub follows: Option<u64>,
    #[serde(default)]
    pub latest_chapter: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_source_label")]
    pub source_label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChapterDto {
    pub id: ChapterId,
    #[serde(default)]
    pub chapter: Option<String>,
    #[serde(default)]
    pub volume: Option<String>,
    pub title: String,
    pub lang: String,
    pub pages: u64,
    pub external_url: Option<String>,
    pub publish_at: String,
    pub group: String,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_source_label")]
    pub source_label: String,
    #[serde(default)]
    pub readable: bool,
}

fn default_source() -> String {
    "mangadex".to_owned()
}

fn default_source_label() -> String {
    "MangaDex".to_owned()
}

/// Display label for a source id; unknown sources keep the primary label.
pub fn source_label(source: &str) -> &'static str {
    match source {
        "comick" => "Comick",
        _ => "MangaDex",
    }
}

/// Single-chapter authority for the BFF reader ticket. Manga ownership comes
/// from the chapter's manga relationship, not from a client-supplied list.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChapterMetadataDto {
    pub id: String,
    pub manga_id: String,
    pub lang: String,
    pub pages: u64,
    pub external_url: Option<String>,
    pub unavailable: bool,
    #[serde(default)]
    pub chapter: Option<String>,
    #[serde(default)]
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PagesResponse {
    pub pages: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChaptersResponse {
    pub vi: Vec<ChapterDto>,
    pub en: Vec<ChapterDto>,
}

/// Bounded, continuation-based feed used only by chapter notifications. Unlike
/// the public chapter list, every published chapter is addressable by offset.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChapterFeedPage {
    pub items: Vec<ChapterDto>,
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
    pub next_offset: Option<u32>,
    pub partial: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<MangaSummaryDto>,
    pub total: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LatestChapterDto {
    pub id: ChapterId,
    #[serde(default)]
    pub chapter: Option<String>,
    pub lang: String,
    pub publish_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LatestMangaDto {
    #[serde(flatten)]
    pub manga: MangaSummaryDto,
    pub chapters: Vec<LatestChapterDto>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub group: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReaderSettingsDto {
    pub mode: ReaderMode,
    pub fit: bool,
    pub bg: ReaderBackground,
    pub speed: u8,
}

impl From<ReaderSettings> for ReaderSettingsDto {
    fn from(value: ReaderSettings) -> Self {
        Self {
            mode: value.mode,
            fit: value.fit,
            bg: value.bg,
            speed: value.speed,
        }
    }
}

impl From<ReaderSettingsDto> for ReaderSettings {
    fn from(value: ReaderSettingsDto) -> Self {
        Self {
            mode: value.mode,
            fit: value.fit,
            bg: value.bg,
            speed: value.speed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn manga_summary_contract_keeps_existing_fields_and_accepts_legacy_omissions() {
        let legacy = json!({
            "id": "manga-id",
            "title": "Title",
            "cover_file": null,
            "status": "ongoing",
            "year": 2024,
            "description": "Description",
            "tags": ["Action"],
            "author": "Author",
            "artist": "Artist"
        });
        let manga: MangaSummaryDto = serde_json::from_value(legacy).unwrap();
        let encoded = serde_json::to_value(&manga).unwrap();
        for field in [
            "id",
            "title",
            "cover_file",
            "status",
            "year",
            "description",
            "tags",
            "tag_ids",
            "author",
            "artist",
            "rating",
            "follows",
            "latest_chapter",
        ] {
            assert!(encoded.get(field).is_some(), "missing `{field}`");
        }
        assert_eq!(encoded["id"], "manga-id");
        assert_eq!(encoded["tags"], json!(["Action"]));

        let latest = LatestMangaDto {
            manga,
            chapters: vec![LatestChapterDto {
                id: "chapter-id".into(),
                chapter: Some("1".into()),
                lang: "vi".into(),
                publish_at: "2026-11-20T00:00:00Z".into(),
            }],
        };
        let latest = serde_json::to_value(latest).unwrap();
        assert!(latest.get("manga").is_none());
        assert_eq!(latest["title"], "Title");
        assert_eq!(latest["chapters"][0]["id"], "chapter-id");
    }

    #[test]
    fn chapter_and_pages_contracts_keep_existing_json_shapes() {
        let chapter = ChapterDto {
            id: "chapter-id".into(),
            chapter: Some("1".into()),
            volume: None,
            title: String::new(),
            lang: "vi".into(),
            pages: 12,
            external_url: None,
            publish_at: String::new(),
            group: String::new(),
            source: "mangadex".into(),
            source_label: "MangaDex".into(),
            readable: true,
        };
        let chapters = serde_json::to_value(chapter).unwrap();
        for field in [
            "id",
            "chapter",
            "volume",
            "title",
            "lang",
            "pages",
            "external_url",
            "publish_at",
            "group",
        ] {
            assert!(chapters.get(field).is_some(), "missing `{field}`");
        }
        let pages: Value = serde_json::to_value(PagesResponse {
            pages: vec!["/api/content/img?u=x".into()],
        })
        .unwrap();
        assert_eq!(pages, json!({ "pages": ["/api/content/img?u=x"] }));
    }

    #[test]
    fn notification_feed_page_keeps_continuation_and_partial_flags() {
        let page = ChapterFeedPage {
            items: vec![],
            total: 12_345,
            offset: 9_900,
            limit: 500,
            next_offset: Some(10_400),
            partial: true,
        };
        assert_eq!(
            serde_json::to_value(page).unwrap(),
            json!({
                "items": [],
                "total": 12345,
                "offset": 9900,
                "limit": 500,
                "next_offset": 10400,
                "partial": true
            })
        );
    }

    #[test]
    fn structured_errors_have_stable_nested_envelope() {
        let error =
            ApiError::new("VALIDATION_ERROR", "Invalid input").with_detail("field", "title");
        assert_eq!(
            serde_json::to_value(ApiErrorEnvelope { error }).unwrap(),
            json!({
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid input",
                    "details": { "field": "title" }
                }
            })
        );
    }

    #[test]
    fn manga_summary_defaults_source_to_mangadex() {
        let legacy = json!({
            "id": "manga-id",
            "title": "Title",
            "cover_file": null,
            "status": "ongoing",
            "year": 2024,
            "description": "Description",
            "tags": ["Action"],
            "author": "Author",
            "artist": "Artist"
        });
        let manga: MangaSummaryDto = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(manga.source, "mangadex");
        assert_eq!(manga.source_label, "MangaDex");

        let mut comick = legacy;
        comick["source"] = json!("comick");
        comick["source_label"] = json!("Comick");
        let manga: MangaSummaryDto = serde_json::from_value(comick).unwrap();
        assert_eq!(manga.source, "comick");
        assert_eq!(manga.source_label, "Comick");
    }

    #[test]
    fn chapter_defaults_source_to_mangadex() {
        let legacy = json!({
            "id": "chapter-id",
            "chapter": "1",
            "volume": null,
            "title": "Title",
            "lang": "vi",
            "pages": 12,
            "external_url": null,
            "publish_at": "2026-11-20T00:00:00Z",
            "group": "Group"
        });
        let chapter: ChapterDto = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(chapter.source, "mangadex");
        assert_eq!(chapter.source_label, "MangaDex");

        let mut comick = legacy;
        comick["source"] = json!("comick");
        let chapter: ChapterDto = serde_json::from_value(comick).unwrap();
        assert_eq!(chapter.source, "comick");
        assert_eq!(source_label(&chapter.source), "Comick");
    }

    #[test]
    fn source_label_maps_known_sources() {
        assert_eq!(source_label("mangadex"), "MangaDex");
        assert_eq!(source_label("comick"), "Comick");
        assert_eq!(source_label("unknown"), "MangaDex");
    }
}
