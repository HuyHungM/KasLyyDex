use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct ReaderSettings {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_fit")]
    pub fit: bool,
    #[serde(default = "default_bg")]
    pub bg: String,
    #[serde(default = "default_speed")]
    pub speed: u8,
}

fn default_mode() -> String {
    "vertical".into()
}

fn default_fit() -> bool {
    true
}

fn default_bg() -> String {
    "light".into()
}

fn default_speed() -> u8 {
    3
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            fit: default_fit(),
            bg: default_bg(),
            speed: default_speed(),
        }
    }
}

const KEY: &str = "truyenviet:reader";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok()?
}

/// Parse path used by get(); bad or out-of-range settings degrade to defaults.
pub fn from_json(raw: &str) -> ReaderSettings {
    let Ok(s) = serde_json::from_str::<ReaderSettings>(raw) else {
        return ReaderSettings::default();
    };
    if !matches!(s.mode.as_str(), "vertical" | "horizontal")
        || !matches!(s.bg.as_str(), "light" | "sepia" | "dark")
        || !(1..=5).contains(&s.speed)
    {
        return ReaderSettings::default();
    }
    s
}

pub fn get() -> ReaderSettings {
    storage()
        .and_then(|s| s.get_item(KEY).ok().flatten())
        .map(|raw| from_json(&raw))
        .unwrap_or_default()
}

pub fn save(settings: &ReaderSettings) {
    if let Some(s) = storage() {
        let _ = s.set_item(KEY, &serde_json::to_string(settings).unwrap_or_default());
    }
}

pub fn step_page(page: usize, total: usize, direction: isize) -> usize {
    page.saturating_add_signed(direction).min(total.saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_turns_stay_inside_chapter() {
        assert_eq!(step_page(0, 0, 1), 0);
        assert_eq!(step_page(0, 3, -1), 0);
        assert_eq!(step_page(0, 3, 1), 1);
        assert_eq!(step_page(2, 3, 1), 2);
    }

    #[test]
    fn corrupt_json_is_default() {
        assert_eq!(from_json("{"), ReaderSettings::default());
        assert_eq!(from_json("null"), ReaderSettings::default());
        assert_eq!(from_json(""), ReaderSettings::default());
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s = from_json(r#"{"mode":"horizontal"}"#);
        assert_eq!(s.mode, "horizontal");
        assert_eq!(s, ReaderSettings { mode: "horizontal".into(), ..ReaderSettings::default() });
    }

    #[test]
    fn invalid_values_fall_back_to_defaults() {
        assert_eq!(from_json(r#"{"mode":"bogus"}"#).mode, "vertical");
        assert_eq!(from_json(r#"{"bg":"neon"}"#).bg, "light");
        assert_eq!(from_json(r#"{"speed":99}"#).speed, 3);
    }

    #[test]
    fn serde_roundtrip() {
        let s = ReaderSettings {
            mode: "horizontal".into(),
            fit: false,
            bg: "sepia".into(),
            speed: 5,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(from_json(&json), s);
    }
}
