use serde::{Deserialize, Serialize};

pub use crate::pure::{filter_url, rel_date, tag_label};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct MangaSummary {
    pub id: String,
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
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Chapter {
    pub id: String,
    pub chapter: Option<String>,
    pub volume: Option<String>,
    pub title: String,
    pub lang: String,
    pub pages: u32,
    pub external_url: Option<String>,
    pub publish_at: String,
    pub group: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Chapters {
    pub vi: Vec<Chapter>,
    pub en: Vec<Chapter>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SearchRes {
    pub results: Vec<MangaSummary>,
    pub total: u64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct PagesRes {
    pub pages: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct LatestManga {
    #[serde(flatten)]
    pub manga: MangaSummary,
    pub chapters: Vec<LatestChapter>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct LatestChapter {
    pub id: String,
    pub chapter: Option<String>,
    pub lang: String,
    pub publish_at: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub group: String,
}

pub async fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let res = gloo_net::http::Request::get(url)
        .send()
        .await
        .map_err(|_| "Không kết nối được. Kiểm tra mạng rồi thử lại.".to_owned())?;
    if !res.ok() {
        return Err(format!("Không tải được dữ liệu (mã {}).", res.status()));
    }
    res.json::<T>().await.map_err(|_| "Dữ liệu trả về không đọc được.".to_owned())
}

pub fn cover_url(m: &MangaSummary, size: u32) -> Option<String> {
    m.cover_file
        .as_ref()
        .map(|f| format!("https://uploads.mangadex.org/covers/{}/{}.{}.jpg", m.id, f, size))
}

/// Same-origin image proxy (server handles DNS sinkholes + disk cache).
pub fn proxy(url: &str) -> String {
    format!(
        "/api/img?u={}",
        js_sys::encode_uri_component(url).as_string().unwrap_or_default()
    )
}

pub fn chapter_label(c: &Chapter) -> String {
    chapter_name(c.chapter.as_deref())
}

pub fn chapter_name(number: Option<&str>) -> String {
    number.map(|n| format!("Chương {n}")).unwrap_or_else(|| "Truyện ngắn".into())
}

pub fn status_text(s: &str) -> &str {
    match s {
        "ongoing" => "Đang tiến hành",
        "completed" => "Hoàn thành",
        "hiatus" => "Tạm ngưng",
        "cancelled" => "Đã hủy",
        other => other,
    }
}
