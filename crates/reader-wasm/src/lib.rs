//! wasm-bindgen adapter over the pure Rust `reader-core` state machine.
//!
//! The JavaScript side only loads this module and forwards user intent; all
//! page bounds, progress and settings normalization live in Rust.

use reader_core::{ReaderBackground, ReaderError, ReaderMode, ReaderSettings, ReaderState};
use wasm_bindgen::prelude::*;

fn to_js(error: ReaderError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Pure Rust construction used by both the wasm constructor and native tests.
fn try_new(total_pages: u32) -> Result<ReaderState, ReaderError> {
    ReaderState::new(total_pages as usize)
}

fn try_set_page(state: &mut ReaderState, page_index: u32) -> Result<(), ReaderError> {
    state.set_page(page_index as usize)
}

fn try_set_mode(state: &mut ReaderState, mode: &str) -> Result<(), String> {
    let mut settings = state.settings().clone();
    settings.mode = parse_mode(mode)?;
    state.set_settings(settings);
    Ok(())
}

fn try_set_background(state: &mut ReaderState, bg: &str) -> Result<(), String> {
    let mut settings = state.settings().clone();
    settings.bg = parse_background(bg)?;
    state.set_settings(settings);
    Ok(())
}

fn parse_mode(mode: &str) -> Result<ReaderMode, String> {
    match mode {
        "vertical" => Ok(ReaderMode::Vertical),
        "horizontal" => Ok(ReaderMode::Horizontal),
        _ => Err(format!("invalid reader mode: {mode}")),
    }
}

fn parse_background(bg: &str) -> Result<ReaderBackground, String> {
    match bg {
        "light" => Ok(ReaderBackground::Light),
        "sepia" => Ok(ReaderBackground::Sepia),
        "dark" => Ok(ReaderBackground::Dark),
        _ => Err(format!("invalid reader background: {bg}")),
    }
}

#[wasm_bindgen]
pub struct ReaderWasm {
    state: ReaderState,
}

#[wasm_bindgen]
impl ReaderWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(total_pages: u32) -> Result<ReaderWasm, JsValue> {
        try_new(total_pages)
            .map(|state| Self { state })
            .map_err(to_js)
    }

    #[wasm_bindgen(js_name = pageIndex)]
    pub fn page_index(&self) -> u32 {
        self.state.page_index() as u32
    }

    #[wasm_bindgen(js_name = totalPages)]
    pub fn total_pages(&self) -> u32 {
        self.state.total_pages() as u32
    }

    #[wasm_bindgen(js_name = setPage)]
    pub fn set_page(&mut self, page_index: u32) -> Result<(), JsValue> {
        try_set_page(&mut self.state, page_index).map_err(to_js)
    }

    #[wasm_bindgen(js_name = nextPage)]
    pub fn next_page(&mut self) -> bool {
        self.state.next_page()
    }

    #[wasm_bindgen(js_name = previousPage)]
    pub fn previous_page(&mut self) -> bool {
        self.state.previous_page()
    }

    #[wasm_bindgen(js_name = canNext)]
    pub fn can_next(&self) -> bool {
        self.state.can_next()
    }

    #[wasm_bindgen(js_name = canPrevious)]
    pub fn can_previous(&self) -> bool {
        self.state.can_previous()
    }

    #[wasm_bindgen(js_name = progressPercent)]
    pub fn progress_percent(&self) -> u8 {
        self.state.progress_percent()
    }

    #[wasm_bindgen(js_name = readingProgressJson)]
    pub fn reading_progress_json(&self) -> String {
        serde_json::to_string(&self.state.reading_progress()).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = settingsJson)]
    pub fn settings_json(&self) -> String {
        serde_json::to_string(self.state.settings()).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = applySettingsJson)]
    pub fn apply_settings_json(&mut self, json: &str) -> Result<(), JsValue> {
        let settings: ReaderSettings =
            serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.state.set_settings(settings);
        Ok(())
    }

    #[wasm_bindgen(js_name = setMode)]
    pub fn set_mode(&mut self, mode: &str) -> Result<(), JsValue> {
        try_set_mode(&mut self.state, mode).map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = setBackground)]
    pub fn set_background(&mut self, bg: &str) -> Result<(), JsValue> {
        try_set_background(&mut self.state, bg).map_err(|error| JsValue::from_str(&error))
    }

    #[wasm_bindgen(js_name = setFit)]
    pub fn set_fit(&mut self, fit: bool) {
        let mut settings = self.state.settings().clone();
        settings.fit = fit;
        self.state.set_settings(settings);
    }

    #[wasm_bindgen(js_name = setSpeed)]
    pub fn set_speed(&mut self, speed: u8) {
        let mut settings = self.state.settings().clone();
        settings.speed = speed;
        self.state.set_settings(settings);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_and_page_bounds_match_reader_core() {
        let mut state = try_new(4).unwrap();
        assert_eq!(state.page_index(), 0);
        assert!(try_set_page(&mut state, 3).is_ok());
        assert!(try_set_page(&mut state, 4).is_err());
        assert_eq!(state.progress_percent(), 100);
        assert!(try_new(0).is_err());
    }

    #[test]
    fn mode_and_background_changes_validate_against_core_enums() {
        let mut state = try_new(2).unwrap();
        try_set_mode(&mut state, "horizontal").unwrap();
        assert_eq!(state.settings().mode, ReaderMode::Horizontal);
        assert!(try_set_mode(&mut state, "diagonal").is_err());
        try_set_background(&mut state, "sepia").unwrap();
        assert_eq!(state.settings().bg, ReaderBackground::Sepia);
        assert!(try_set_background(&mut state, "neon").is_err());
    }

    #[test]
    fn settings_json_roundtrip_preserves_wire_values() {
        let mut state = try_new(2).unwrap();
        try_set_mode(&mut state, "horizontal").unwrap();
        let json = serde_json::to_string(state.settings()).unwrap();
        assert_eq!(
            json,
            r#"{"mode":"horizontal","fit":true,"bg":"light","speed":3}"#
        );
        let restored: ReaderSettings = serde_json::from_str(&json).unwrap();
        state.set_settings(restored);
        assert_eq!(state.settings().mode, ReaderMode::Horizontal);
    }
}
