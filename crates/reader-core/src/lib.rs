pub use domain::{ReaderBackground, ReaderMode, ReaderSettings, ReadingProgress};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReaderError {
    InvalidPageCount,
    PageOutOfBounds {
        page_index: usize,
        total_pages: usize,
    },
}

impl std::fmt::Display for ReaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPageCount => f.write_str("total_pages must be greater than zero"),
            Self::PageOutOfBounds {
                page_index,
                total_pages,
            } => {
                write!(f, "page index {page_index} is outside 0..{total_pages}")
            }
        }
    }
}

impl std::error::Error for ReaderError {}

#[derive(Clone, Debug, PartialEq)]
pub struct ReaderState {
    page_index: usize,
    total_pages: usize,
    settings: ReaderSettings,
}

impl ReaderState {
    pub fn new(total_pages: usize) -> Result<Self, ReaderError> {
        Self::with_settings(total_pages, ReaderSettings::default())
    }

    pub fn with_settings(
        total_pages: usize,
        settings: ReaderSettings,
    ) -> Result<Self, ReaderError> {
        if total_pages == 0 {
            return Err(ReaderError::InvalidPageCount);
        }
        Ok(Self {
            page_index: 0,
            total_pages,
            settings: settings.normalized(),
        })
    }

    pub fn page_index(&self) -> usize {
        self.page_index
    }

    pub fn total_pages(&self) -> usize {
        self.total_pages
    }

    pub fn settings(&self) -> &ReaderSettings {
        &self.settings
    }

    pub fn set_settings(&mut self, settings: ReaderSettings) {
        self.settings = settings.normalized();
    }

    pub fn set_page(&mut self, page_index: usize) -> Result<(), ReaderError> {
        if page_index >= self.total_pages {
            return Err(ReaderError::PageOutOfBounds {
                page_index,
                total_pages: self.total_pages,
            });
        }
        self.page_index = page_index;
        Ok(())
    }

    pub fn next_page(&mut self) -> bool {
        if self.can_next() {
            self.page_index += 1;
            true
        } else {
            false
        }
    }

    pub fn previous_page(&mut self) -> bool {
        if self.can_previous() {
            self.page_index -= 1;
            true
        } else {
            false
        }
    }

    pub fn progress_percent(&self) -> u8 {
        self.reading_progress().percent
    }

    pub fn reading_progress(&self) -> ReadingProgress {
        ReadingProgress::new(self.page_index, self.total_pages)
            .expect("ReaderState is always valid")
    }

    pub fn can_next(&self) -> bool {
        self.page_index + 1 < self.total_pages
    }

    pub fn can_previous(&self) -> bool {
        self.page_index > 0
    }
}

#[cfg(test)]
mod tests;
