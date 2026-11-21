use crate::{comick, imgcache, mangadex, Comick, Md};
use comick::{is_comick_chapter_id, ComickChapter};
use contracts::{ChapterDto, ChapterMetadataDto, ChaptersResponse, MangaSummaryDto, PagesResponse};
use mangadex::is_uuid;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SOURCE: &str = "comick";
const SOURCE_LABEL: &str = "Comick";
const POSITIVE_TTL_SECS: u64 = 3_600;
const NEGATIVE_TTL_SECS: u64 = 60;
const MAX_TTL_SECS: u64 = 86_400;
const MAX_CACHE_BYTES: u64 = 4_096;
const MAX_CACHE_FILES: usize = 512;
const MAX_TITLE_CANDIDATES: usize = 3;

#[derive(Clone)]
pub struct ContentState {
    pub md: Md,
    pub comick: Option<Comick>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CachedMatch {
    manga_id: String,
    comic_id: String,
    chapter_id: String,
    chapter: String,
    lang: String,
    title: String,
    publish_at: String,
    group: String,
    pages: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CacheValue {
    Hit { mapping: CachedMatch },
    Miss,
}

#[derive(Serialize, Deserialize)]
struct CacheEnvelope {
    expires: u64,
    value: CacheValue,
}

/// Source-aware chapter lists: MangaDex stays primary; Comick only fills gaps.
pub async fn enrich_chapters(
    state: &ContentState,
    manga: &MangaSummaryDto,
    mut chapters: ChaptersResponse,
) -> Result<ChaptersResponse, String> {
    let Some(comick) = state.comick.as_ref() else {
        return Ok(chapters);
    };
    let needs_fallback = chapters
        .vi
        .iter()
        .chain(chapters.en.iter())
        .any(|chapter| !is_readable(chapter));
    if !needs_fallback {
        return Ok(chapters);
    }
    let titles = comick.search_titles(&manga.title).await.unwrap_or_default();
    let titles: Vec<_> = titles
        .into_iter()
        .filter(|title| title_matches(&manga.title, title))
        .take(MAX_TITLE_CANDIDATES)
        .collect();
    if titles.is_empty() {
        return Ok(chapters);
    }

    // One bounded search + up to two language fetches per title candidate.
    let mut candidates = Vec::new();
    let mut comic_by_chapter = HashMap::new();
    for title in &titles {
        for lang in ["vi", "en"] {
            if let Ok(found) = comick.chapters(&title.hid, lang).await {
                for candidate in found {
                    comic_by_chapter.insert(candidate.id.clone(), title.hid.clone());
                    candidates.push(candidate);
                }
            }
        }
    }
    if candidates.is_empty() {
        return Ok(chapters);
    }

    chapters.vi = enrich_list(
        comick,
        manga.id.as_str(),
        chapters.vi,
        &candidates,
        &comic_by_chapter,
    )
    .await;
    chapters.en = enrich_list(
        comick,
        manga.id.as_str(),
        chapters.en,
        &candidates,
        &comic_by_chapter,
    )
    .await;
    Ok(chapters)
}

/// Source-aware page lookup; every returned URL stays on this origin.
pub async fn chapter_pages(
    state: &ContentState,
    chapter_id: &str,
) -> Result<PagesResponse, String> {
    if is_comick_chapter_id(chapter_id) {
        let comick = state
            .comick
            .as_ref()
            .ok_or_else(|| "Comick catalog unavailable".to_owned())?;
        let urls = comick.page_urls(chapter_id).await?;
        if urls.is_empty() {
            return Err("Comick chapter has no readable pages.".to_owned());
        }
        return Ok(PagesResponse {
            pages: urls.iter().map(|url| image_proxy_path(url)).collect(),
        });
    }
    if !is_uuid(chapter_id) {
        return Err("Mã chương không hợp lệ.".to_owned());
    }
    state.md.pages(chapter_id).await
}

/// Fallback metadata comes from the cached mapping made by `enrich_chapters`.
pub async fn chapter_metadata(
    state: &ContentState,
    chapter_id: &str,
) -> Result<ChapterMetadataDto, String> {
    if is_comick_chapter_id(chapter_id) {
        let mapping = cached_mapping(chapter_id)
            .ok_or_else(|| "Comick chapter mapping unavailable".to_owned())?;
        return Ok(ChapterMetadataDto {
            id: mapping.chapter_id,
            manga_id: mapping.manga_id,
            lang: mapping.lang,
            pages: mapping.pages,
            external_url: None,
            unavailable: mapping.pages == 0,
            chapter: Some(mapping.chapter),
            title: mapping.title,
        });
    }
    if !is_uuid(chapter_id) {
        return Err("Mã chương không hợp lệ.".to_owned());
    }
    state.md.chapter_metadata(chapter_id).await
}

/// Bounded, path-safe disk key: source, primary manga, chapter and language.
pub fn fallback_cache_key(manga_id: &str, chapter: &str, lang: &str) -> String {
    let number = normalize_chapter_number(Some(chapter)).unwrap_or_else(|| chapter.to_owned());
    let raw = format!("{SOURCE}\0{manga_id}\0{number}\0{lang}");
    format!("fallback-comick-{:x}", Sha256::digest(raw.as_bytes()))
}

async fn enrich_list(
    comick: &Comick,
    manga_id: &str,
    chapters: Vec<ChapterDto>,
    candidates: &[ComickChapter],
    comic_by_chapter: &HashMap<String, String>,
) -> Vec<ChapterDto> {
    let mut out = Vec::with_capacity(chapters.len());
    for chapter in chapters {
        if is_readable(&chapter) {
            out.push(chapter);
            continue;
        }
        let number = chapter.chapter.as_deref().unwrap_or("");
        let key = fallback_cache_key(manga_id, number, &chapter.lang);
        let mapping = match read_cache_value(&key) {
            Some(CacheValue::Hit { mapping }) if is_comick_chapter_id(&mapping.chapter_id) => {
                Some(mapping)
            }
            Some(CacheValue::Miss) => None,
            _ => {
                let mut found = None;
                if let Some(candidate) = match_chapter(number, &chapter.lang, candidates) {
                    if let Ok(urls) = comick.page_urls(&candidate.id).await {
                        if !urls.is_empty() {
                            found = Some(CachedMatch {
                                manga_id: manga_id.to_owned(),
                                comic_id: comic_by_chapter
                                    .get(&candidate.id)
                                    .cloned()
                                    .unwrap_or_else(|| candidate.id.clone()),
                                chapter_id: candidate.id.clone(),
                                chapter: number.to_owned(),
                                lang: candidate.lang.clone(),
                                title: candidate.title.clone(),
                                publish_at: candidate.publish_at.clone(),
                                group: candidate.group.clone(),
                                pages: urls.len() as u64,
                            });
                        }
                    }
                }
                match found {
                    Some(mapping) => {
                        write_cache_value(
                            &key,
                            &CacheValue::Hit {
                                mapping: mapping.clone(),
                            },
                            POSITIVE_TTL_SECS,
                        );
                        Some(mapping)
                    }
                    None => {
                        write_cache_value(&key, &CacheValue::Miss, NEGATIVE_TTL_SECS);
                        None
                    }
                }
            }
        };
        out.push(mapping.map(fallback_chapter).unwrap_or(chapter));
    }
    out
}

fn fallback_chapter(mapping: CachedMatch) -> ChapterDto {
    ChapterDto {
        id: mapping.chapter_id.into(),
        chapter: Some(mapping.chapter),
        volume: None,
        title: mapping.title,
        lang: mapping.lang,
        pages: mapping.pages,
        external_url: None,
        publish_at: mapping.publish_at,
        group: mapping.group,
        source: SOURCE.to_owned(),
        source_label: SOURCE_LABEL.to_owned(),
        readable: true,
    }
}

fn is_readable(chapter: &ChapterDto) -> bool {
    chapter.readable || (chapter.pages > 0 && chapter.external_url.is_none())
}

fn title_matches(manga_title: &str, candidate: &comick::ComickTitle) -> bool {
    let wanted = normalize_title(manga_title);
    wanted == normalize_title(&candidate.title)
        || candidate
            .aliases
            .iter()
            .any(|alias| wanted == normalize_title(alias))
}

fn normalize_title(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Canonical numeric chapter label. Decimal labels stay distinct from neighbors.
fn normalize_chapter_number(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    let value = value.strip_prefix('#').unwrap_or(value).trim();
    if value.is_empty() {
        return None;
    }
    let (whole, fraction) = match value.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (value, None),
    };
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if fraction.is_some_and(|fraction| {
        fraction.is_empty() || !fraction.bytes().all(|b| b.is_ascii_digit())
    }) {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    let mut out = if whole.is_empty() { "0" } else { whole }.to_owned();
    if let Some(fraction) = fraction {
        let fraction = fraction.trim_end_matches('0');
        if !fraction.is_empty() {
            out.push('.');
            out.push_str(fraction);
        }
    }
    Some(out)
}

fn match_chapter<'a>(
    chapter: &str,
    lang: &str,
    candidates: &'a [ComickChapter],
) -> Option<&'a ComickChapter> {
    let number = normalize_chapter_number(Some(chapter))?;
    let mut matches: Vec<_> = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| {
            candidate.lang.eq_ignore_ascii_case(lang)
                && normalize_chapter_number(candidate.chapter.as_deref()).as_deref()
                    == Some(number.as_str())
        })
        .collect();
    // Language preference first (vi before en), provider order breaks ties.
    matches.sort_by_key(|(index, candidate)| (language_rank(&candidate.lang), *index));
    matches.first().map(|(_, candidate)| *candidate)
}

fn language_rank(lang: &str) -> u8 {
    if lang.eq_ignore_ascii_case("vi") {
        0
    } else if lang.eq_ignore_ascii_case("en") {
        1
    } else {
        2
    }
}

fn image_proxy_path(url: &str) -> String {
    format!(
        "/api/content/img?u={}",
        utf8_percent_encode(url, NON_ALPHANUMERIC)
    )
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_cache_value(key: &str) -> Option<CacheValue> {
    read_cache_value_at(&imgcache::cache_dir(), key, now_secs())
}

fn read_cache_value_at(dir: &Path, key: &str, now: u64) -> Option<CacheValue> {
    let path = dir.join(key);
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > MAX_CACHE_BYTES {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let envelope: CacheEnvelope = serde_json::from_slice(&bytes).ok()?;
    (envelope.expires > now).then_some(envelope.value)
}

fn write_cache_value(key: &str, value: &CacheValue, ttl_secs: u64) {
    write_cache_value_at(&imgcache::cache_dir(), key, value, ttl_secs, now_secs());
}

fn write_cache_value_at(dir: &Path, key: &str, value: &CacheValue, ttl_secs: u64, now: u64) {
    let Ok(bytes) = serde_json::to_vec(&CacheEnvelope {
        expires: now.saturating_add(ttl_secs.min(MAX_TTL_SECS)),
        value: value.clone(),
    }) else {
        return;
    };
    if bytes.len() as u64 > MAX_CACHE_BYTES || std::fs::create_dir_all(dir).is_err() {
        return;
    }
    prune_cache(dir);
    let _ = std::fs::write(dir.join(key), bytes);
}

fn prune_cache(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, SystemTime)> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("fallback-comick-")
        })
        .filter_map(|entry| Some((entry.path(), entry.metadata().ok()?.modified().ok()?)))
        .collect();
    if files.len() < MAX_CACHE_FILES {
        return;
    }
    files.sort_by_key(|(_, modified)| *modified);
    let excess = files.len() - MAX_CACHE_FILES + 1;
    for (path, _) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

fn cached_mapping(chapter_id: &str) -> Option<CachedMatch> {
    let dir = imgcache::cache_dir();
    let entries = std::fs::read_dir(dir).ok()?;
    let now = now_secs();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("fallback-comick-"))
        {
            continue;
        }
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let envelope: CacheEnvelope = match serde_json::from_slice(&bytes) {
            Ok(envelope) => envelope,
            Err(_) => continue,
        };
        if envelope.expires <= now {
            continue;
        }
        if let CacheValue::Hit { mapping } = envelope.value {
            if mapping.chapter_id == chapter_id {
                return Some(mapping);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manga() -> MangaSummaryDto {
        MangaSummaryDto {
            id: "manga-1".into(),
            title: "Fixture Manga".into(),
            cover_file: None,
            status: "ongoing".into(),
            year: None,
            description: String::new(),
            tags: vec![],
            tag_ids: vec![],
            author: String::new(),
            artist: String::new(),
            rating: None,
            follows: None,
            latest_chapter: None,
            source: "mangadex".into(),
            source_label: "MangaDex".into(),
        }
    }

    fn chapter(
        id: &str,
        number: &str,
        lang: &str,
        pages: u64,
        external: Option<&str>,
    ) -> ChapterDto {
        ChapterDto {
            id: id.into(),
            chapter: Some(number.into()),
            volume: None,
            title: String::new(),
            lang: lang.into(),
            pages,
            external_url: external.map(str::to_owned),
            publish_at: String::new(),
            group: String::new(),
            source: "mangadex".into(),
            source_label: "MangaDex".into(),
            readable: pages > 0 && external.is_none(),
        }
    }

    fn candidate(id: &str, number: &str, lang: &str) -> ComickChapter {
        ComickChapter {
            id: format!("comick:{id}"),
            chapter: Some(number.into()),
            lang: lang.into(),
            title: String::new(),
            publish_at: String::new(),
            group: String::new(),
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kaslyydex-{name}-{unique}"));
        std::fs::create_dir_all(&dir).expect("temp cache dir");
        dir
    }

    #[tokio::test]
    async fn fallback_skips_readable_mangadex_chapter() {
        let state = ContentState {
            md: Md::new(reqwest::Client::new()),
            comick: None,
        };
        let primary = chapter("md-1", "10.1", "vi", 12, None);
        let input = ChaptersResponse {
            vi: vec![primary.clone()],
            en: vec![],
        };
        let output = enrich_chapters(&state, &manga(), input)
            .await
            .expect("primary chapters survive without Comick");
        assert_eq!(output.vi, vec![primary]);
        assert!(output.en.is_empty());
    }

    #[test]
    fn fallback_matches_decimal_chapter_and_language() {
        let candidates = [
            candidate("ten", "10", "vi"),
            candidate("decimal", "10.1", "vi"),
            candidate("other", "10.2", "vi"),
            candidate("english", "10.1", "en"),
        ];
        let matched = match_chapter("10.1", "vi", &candidates).expect("decimal match");
        assert_eq!(matched.id, "comick:decimal");
        assert!(match_chapter("10", "vi", &candidates[1..2]).is_none());
        assert!(match_chapter("10.2", "vi", &candidates[1..2]).is_none());
    }

    #[test]
    fn fallback_rejects_mismatched_chapter_number() {
        let candidates = [candidate("decimal", "10.1", "vi")];
        assert!(match_chapter("10", "vi", &candidates).is_none());
        assert!(match_chapter("10.2", "vi", &candidates).is_none());
        assert_eq!(
            match_chapter("10.1", "vi", &candidates).map(|c| c.id.as_str()),
            Some("comick:decimal")
        );
    }

    #[test]
    fn fallback_prefers_vi_then_en() {
        let candidates = [
            candidate("english", "10.1", "en"),
            candidate("vietnamese", "10.1", "vi"),
        ];
        let matched = match_chapter("10.1", "vi", &candidates).expect("language match");
        assert_eq!(matched.lang, "vi");
        assert_eq!(matched.id, "comick:vietnamese");
    }

    #[test]
    fn fallback_negative_result_is_cached_briefly() {
        let dir = temp_dir("fallback-negative");
        let key = fallback_cache_key("manga-1", "10.1", "vi");
        assert!(!key.contains(':'));
        assert!(!key.contains('/'));
        assert!(!key.contains('\\'));
        write_cache_value_at(&dir, &key, &CacheValue::Miss, NEGATIVE_TTL_SECS, 1_000);
        assert_eq!(
            read_cache_value_at(&dir, &key, 1_001),
            Some(CacheValue::Miss)
        );
        assert_eq!(
            read_cache_value_at(&dir, &key, 1_000 + NEGATIVE_TTL_SECS + 1),
            None
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
