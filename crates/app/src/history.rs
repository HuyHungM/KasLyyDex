use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub manga_id: String,
    pub manga_title: String,
    pub chapter_id: String,
    pub chapter: Option<String>,
    pub cover_file: Option<String>,
    pub lang: String,
    pub ts: u64,
}

fn path() -> PathBuf {
    core::imgcache::cache_dir().join("history.json")
}

pub fn load() -> Vec<HistoryEntry> {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn push(e: HistoryEntry) {
    let mut list: Vec<HistoryEntry> = load().into_iter().filter(|h| h.manga_id != e.manga_id).collect();
    list.insert(0, e);
    list.truncate(30);
    let _ = std::fs::create_dir_all(core::imgcache::cache_dir());
    let _ = std::fs::write(path(), serde_json::to_string(&list).unwrap_or_default());
}

pub fn get_for(manga_id: &str) -> Option<HistoryEntry> {
    load().into_iter().find(|h| h.manga_id == manga_id)
}