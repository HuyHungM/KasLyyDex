use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                self.as_str()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

id_type!(MangaId);
id_type!(ChapterId);
id_type!(UserId);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderMode {
    #[default]
    Vertical,
    Horizontal,
}

impl ReaderMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderBackground {
    #[default]
    Auto,
    Light,
    Sepia,
    Dark,
}

impl ReaderBackground {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Light => "light",
            Self::Sepia => "sepia",
            Self::Dark => "dark",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReaderSettings {
    #[serde(default)]
    pub mode: ReaderMode,
    #[serde(default = "default_fit")]
    pub fit: bool,
    #[serde(default)]
    pub bg: ReaderBackground,
    #[serde(default = "default_speed")]
    pub speed: u8,
}

const fn default_fit() -> bool {
    true
}

const fn default_speed() -> u8 {
    3
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            mode: ReaderMode::Vertical,
            fit: default_fit(),
            bg: ReaderBackground::Auto,
            speed: default_speed(),
        }
    }
}

impl ReaderSettings {
    pub fn is_valid(&self) -> bool {
        (1..=5).contains(&self.speed)
    }

    pub fn normalized(mut self) -> Self {
        if !self.is_valid() {
            self.speed = default_speed();
        }
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub page_index: usize,
    pub total_pages: usize,
    pub percent: u8,
}

impl ReadingProgress {
    pub fn new(page_index: usize, total_pages: usize) -> Option<Self> {
        if total_pages == 0 || page_index >= total_pages {
            return None;
        }
        Some(Self {
            page_index,
            total_pages,
            percent: (((page_index as u128 + 1) * 100) / total_pages as u128) as u8,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Manga {
    pub id: MangaId,
    pub title: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Chapter {
    pub id: ChapterId,
    pub manga_id: MangaId,
    pub title: String,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct CultivationLevel(u16);

impl<'de> Deserialize<'de> for CultivationLevel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let level = u16::deserialize(deserializer)?;
        Self::new(level).ok_or_else(|| serde::de::Error::custom("level must be between 1 and 1000"))
    }
}

impl CultivationLevel {
    pub fn new(level: u16) -> Option<Self> {
        (1..=1000).contains(&level).then_some(Self(level))
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CultivationRealm {
    Mortal,
    QiRefining,
    FoundationEstablishment,
    GoldenCore,
    NascentSoul,
    SpiritSevering,
    VoidRefinement,
    BodyIntegration,
    Mahayana,
    TribulationTranscendence,
    TrueImmortal,
    ImmortalKing,
    ImmortalEmperor,
}

impl CultivationRealm {
    pub fn for_level(level: CultivationLevel) -> Self {
        match level.get() {
            1..=9 => Self::Mortal,
            10..=49 => Self::QiRefining,
            50..=99 => Self::FoundationEstablishment,
            100..=199 => Self::GoldenCore,
            200..=299 => Self::NascentSoul,
            300..=399 => Self::SpiritSevering,
            400..=499 => Self::VoidRefinement,
            500..=599 => Self::BodyIntegration,
            600..=699 => Self::Mahayana,
            700..=799 => Self::TribulationTranscendence,
            800..=899 => Self::TrueImmortal,
            900..=999 => Self::ImmortalKing,
            1000 => Self::ImmortalEmperor,
            _ => unreachable!("CultivationLevel is validated"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reader_background_accepts_auto_and_roundtrips_wire_values() {
        for (background, wire) in [
            (ReaderBackground::Auto, "auto"),
            (ReaderBackground::Light, "light"),
            (ReaderBackground::Sepia, "sepia"),
            (ReaderBackground::Dark, "dark"),
        ] {
            assert_eq!(background.as_str(), wire);
            assert_eq!(serde_json::to_string(&background).unwrap(), format!("\"{wire}\""));
            assert_eq!(
                serde_json::from_str::<ReaderBackground>(&format!("\"{wire}\"")).unwrap(),
                background
            );
        }
        assert_eq!(ReaderSettings::default().bg, ReaderBackground::Auto);
    }

    #[test]
    fn cultivation_level_and_realm_boundaries_are_validated() {
        assert!(CultivationLevel::new(0).is_none());
        assert!(CultivationLevel::new(1001).is_none());
        assert!(serde_json::from_str::<CultivationLevel>("0").is_err());
        assert!(serde_json::from_str::<CultivationLevel>("1001").is_err());
        for (level, realm) in [
            (1, CultivationRealm::Mortal),
            (10, CultivationRealm::QiRefining),
            (50, CultivationRealm::FoundationEstablishment),
            (100, CultivationRealm::GoldenCore),
            (200, CultivationRealm::NascentSoul),
            (300, CultivationRealm::SpiritSevering),
            (400, CultivationRealm::VoidRefinement),
            (500, CultivationRealm::BodyIntegration),
            (600, CultivationRealm::Mahayana),
            (700, CultivationRealm::TribulationTranscendence),
            (800, CultivationRealm::TrueImmortal),
            (900, CultivationRealm::ImmortalKing),
            (1000, CultivationRealm::ImmortalEmperor),
        ] {
            assert_eq!(
                CultivationRealm::for_level(CultivationLevel::new(level).unwrap()),
                realm
            );
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemRole {
    User,
    Moderator,
    Admin,
}
