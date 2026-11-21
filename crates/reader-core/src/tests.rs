use crate::ReaderState;
use crate::{ReaderBackground, ReaderMode, ReaderSettings};

#[test]
fn page_navigation_stays_inside_valid_page_indices() {
    let mut reader = ReaderState::new(3).unwrap();
    assert_eq!(reader.page_index(), 0);
    assert!(!reader.can_previous());
    assert!(reader.can_next());
    assert!(!reader.previous_page());
    assert!(reader.next_page());
    assert_eq!(reader.page_index(), 1);
    assert!(reader.set_page(2).is_ok());
    assert!(!reader.can_next());
    assert!(!reader.next_page());
    assert_eq!(reader.page_index(), 2);
    assert!(reader.set_page(3).is_err());
    assert_eq!(reader.page_index(), 2);
}

#[test]
fn progress_is_a_deterministic_percent_of_pages_seen() {
    let mut reader = ReaderState::new(10).unwrap();
    assert_eq!(reader.progress_percent(), 10);
    reader.set_page(7).unwrap();
    assert_eq!(reader.progress_percent(), 80);
    reader.set_page(9).unwrap();
    assert_eq!(reader.progress_percent(), 100);
}

#[test]
fn invalid_page_counts_are_rejected() {
    assert!(ReaderState::new(0).is_err());
}

#[test]
fn page_counts_at_usize_limit_keep_progress_valid() {
    let reader = ReaderState::new(usize::MAX).unwrap();
    assert_eq!(reader.progress_percent(), 0);
    let mut reader = reader;
    reader.set_page(usize::MAX - 1).unwrap();
    assert_eq!(reader.progress_percent(), 100);
    assert!(!reader.can_next());
}

#[test]
fn reader_settings_preserve_horizontal_and_vertical_wire_values() {
    let horizontal = ReaderSettings {
        mode: ReaderMode::Horizontal,
        ..ReaderSettings::default()
    };
    let vertical = ReaderSettings {
        mode: ReaderMode::Vertical,
        ..ReaderSettings::default()
    };
    assert_eq!(
        serde_json::to_string(&horizontal).unwrap(),
        r#"{"mode":"horizontal","fit":true,"bg":"auto","speed":3}"#
    );
    assert_eq!(
        serde_json::to_string(&vertical).unwrap(),
        r#"{"mode":"vertical","fit":true,"bg":"auto","speed":3}"#
    );
    assert_eq!(
        serde_json::from_str::<ReaderSettings>(
            r#"{"mode":"horizontal","fit":true,"bg":"sepia","speed":3}"#
        )
        .unwrap()
        .mode,
        ReaderMode::Horizontal
    );
    assert_eq!(ReaderBackground::Auto.as_str(), "auto");
    assert_eq!(ReaderBackground::Dark.as_str(), "dark");
    let mut reader = ReaderState::with_settings(1, horizontal.clone()).unwrap();
    assert_eq!(reader.settings().mode, ReaderMode::Horizontal);
    reader.set_settings(vertical);
    assert_eq!(reader.settings().mode, ReaderMode::Vertical);
}
