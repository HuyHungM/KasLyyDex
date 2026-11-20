use crate::api::Chapter;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct HistoryEntry {
    pub manga_id: String,
    pub manga_title: String,
    pub chapter_id: String,
    pub chapter: Option<String>,
    pub title: String,
    pub cover_file: Option<String>,
    pub lang: String,
    pub ts: f64,
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default)]
    pub total: Option<usize>,
}

const KEY: &str = "truyenviet:history";
const MAX: usize = 30;

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok()?
}

pub fn get_history() -> Vec<HistoryEntry> {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn get_for(manga_id: &str) -> Option<HistoryEntry> {
    get_history().into_iter().find(|h| h.manga_id == manga_id)
}

pub fn push(manga_id: &str, manga_title: &str, cover_file: Option<String>, lang: &str, c: &Chapter) {
    let Some(s) = storage() else { return };
    let mut list = get_history();
    let progress = list.iter().find(|h| h.chapter_id == c.id).map(|h| (h.page, h.total)).unwrap_or_default();
    list.retain(|h| h.manga_id != manga_id);
    list.insert(
        0,
        HistoryEntry {
            manga_id: manga_id.into(),
            manga_title: manga_title.into(),
            chapter_id: c.id.clone(),
            chapter: c.chapter.clone(),
            title: c.title.clone(),
            cover_file,
            lang: lang.into(),
            ts: js_sys::Date::now(),
            page: progress.0,
            total: progress.1,
        },
    );
    list.truncate(MAX);
    let _ = s.set_item(KEY, &serde_json::to_string(&list).unwrap_or_default());
}

pub fn save_progress(chapter_id: &str, page: usize, total: usize) {
    let Some(storage) = storage() else { return };
    let mut list = get_history();
    if let Some(entry) = list.iter_mut().find(|h| h.chapter_id == chapter_id) {
        entry.page = Some(page);
        entry.total = Some(total);
        if let Ok(json) = serde_json::to_string(&list) {
            let _ = storage.set_item(KEY, &json);
        }
    }
}
