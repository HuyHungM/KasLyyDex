use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct LibraryEntry {
    pub manga_id: String,
    pub title: String,
    #[serde(default)]
    pub cover_file: Option<String>,
    #[serde(default)]
    pub lang: String,
    #[serde(default)]
    pub followed_at: f64,
    #[serde(default)]
    pub last_chapter_id: Option<String>,
    #[serde(default)]
    pub last_read_publish: f64,
}

const KEY: &str = "truyenviet:library";
const MAX: usize = 200;

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok()?
}

/// Parse path used by get(); bad JSON degrades to an empty bookshelf.
pub fn from_json(raw: &str) -> Vec<LibraryEntry> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn save(list: &[LibraryEntry]) -> bool {
    let Some(s) = storage() else { return false };
    serde_json::to_string(list).is_ok_and(|json| s.set_item(KEY, &json).is_ok())
}

pub fn get() -> Vec<LibraryEntry> {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .map(|raw| from_json(&raw))
        .unwrap_or_default()
}

fn upsert(mut list: Vec<LibraryEntry>, entry: LibraryEntry) -> Vec<LibraryEntry> {
    list.retain(|e| e.manga_id != entry.manga_id);
    list.insert(0, entry);
    list.truncate(MAX);
    list
}

pub fn add(manga_id: &str, title: &str, cover_file: Option<String>, lang: &str) -> bool {
    let entry = LibraryEntry {
        manga_id: manga_id.into(),
        title: title.into(),
        cover_file,
        lang: lang.into(),
        followed_at: js_sys::Date::now(),
        last_chapter_id: None,
        last_read_publish: 0.0,
    };
    save(&upsert(get(), entry))
}

pub fn remove(manga_id: &str) -> bool {
    let list = get()
        .into_iter()
        .filter(|e| e.manga_id != manga_id)
        .collect::<Vec<_>>();
    save(&list)
}

pub fn set_last(manga_id: &str, chapter_id: &str, lang: &str, published: f64) {
    let mut list = get();
    if let Some(entry) = list.iter_mut().find(|e| e.manga_id == manga_id && e.lang == lang) {
        if !entry.has_update(chapter_id, published) {
            return;
        }
        entry.last_chapter_id = Some(chapter_id.into());
        entry.last_read_publish = published;
        save(&list);
    }
}

impl LibraryEntry {
    pub fn has_update(&self, latest_id: &str, published: f64) -> bool {
        !latest_id.is_empty() && self.last_chapter_id.as_deref() != Some(latest_id)
            && published > self.followed_at.max(self.last_read_publish)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, last: Option<&str>) -> LibraryEntry {
        LibraryEntry {
            manga_id: id.into(),
            title: format!("Truyện {id}"),
            cover_file: None,
            lang: "vi".into(),
            followed_at: 1_700_000_000_000.0,
            last_chapter_id: last.map(str::to_string),
            last_read_publish: 1_700_000_000_000.0,
        }
    }

    #[test]
    fn corrupt_json_is_empty() {
        assert!(from_json("{").is_empty());
        assert!(from_json("null").is_empty());
        assert!(from_json("[]").is_empty());
    }

    #[test]
    fn entry_serde_roundtrip() {
        let e = entry("abc", Some("ch-1"));
        let json = format!("[{}]", serde_json::to_string(&e).unwrap());
        assert_eq!(from_json(&json), vec![e]);
        let old = r#"[{"manga_id":"abc","title":"T","followed_at":1}]"#;
        assert_eq!(from_json(old)[0].last_chapter_id, None);
    }

    #[test]
    fn upsert_dedupes_keeps_newest_first_and_caps_at_200() {
        let list = (0..200).map(|i| entry(&format!("m{i}"), None)).collect();
        let list = upsert(list, entry("m0", Some("ch-2")));
        assert_eq!(list.len(), 200);
        assert_eq!(list[0].manga_id, "m0");
        assert_eq!(list[0].last_chapter_id.as_deref(), Some("ch-2"));
        assert_eq!(list.iter().filter(|e| e.manga_id == "m0").count(), 1);
        assert_eq!(list.last().unwrap().manga_id, "m199");

        let list = upsert(vec![entry("old", None)], entry("new", None));
        assert_eq!(list[0].manga_id, "new");
        assert_eq!(list[1].manga_id, "old");
    }

    #[test]
    fn updates_compare_latest_with_last_read() {
        let mut entry = entry("a", Some("old"));
        let past = entry.followed_at;
        assert!(entry.has_update("new", past + 1.0));
        assert!(!entry.has_update("old", past + 2.0));
        assert!(!entry.has_update("older", past - 1.0));
        entry.last_read_publish = past + 2.0;
        assert!(!entry.has_update("new", past + 1.0));
        assert!(!entry.has_update("", past + 3.0));
    }
}
