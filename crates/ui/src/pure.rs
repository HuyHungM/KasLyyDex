//! Date/tag/URL helpers with no WASM or crate dependencies.
//! Kept standalone so they can be tested on any host target.

/// ISO yyyy-mm-dd... -> dd/mm/yyyy without a date crate.
pub fn fmt_date(iso: &str) -> String {
    let b = iso.as_bytes();
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' {
        format!("{}/{}/{}", &iso[8..10], &iso[5..7], &iso[0..4])
    } else {
        String::new()
    }
}

/// Days since 1970-01-01 (Howard Hinnant's civil-date algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse an ISO timestamp to epoch milliseconds (UTC). No date crate.
fn iso_ms(iso: &str) -> Option<f64> {
    let b = iso.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |a: usize, z: usize| -> Option<i64> {
        std::str::from_utf8(&b[a..z]).ok()?.parse::<i64>().ok()
    };
    let y = num(0, 4)?;
    let mo = num(5, 7)?;
    let d = num(8, 10)?;
    let h = num(11, 13)?;
    let mi = num(14, 16)?;
    let s = num(17, 19)?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 59 {
        return None;
    }
    let mut ms = 0i64;
    let mut i = 19;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() && i - start < 3 {
            i += 1;
        }
        if i == start {
            return None;
        }
        let frac = num(start, i)?;
        ms = frac * 10_i64.pow((3 - (i - start)) as u32);
    }
    let mut offset = 0i64;
    match b.get(i) {
        Some(b'Z') | Some(b'z') => i += 1,
        Some(b'+') | Some(b'-') => {
            let sign = if b[i] == b'-' { -1 } else { 1 };
            if i + 6 > b.len() || b[i + 3] != b':' {
                return None;
            }
            let oh = num(i + 1, i + 3)?;
            let om = num(i + 4, i + 6)?;
            if oh > 23 || om > 59 {
                return None;
            }
            offset = sign * (oh * 3600 + om * 60);
            i += 6;
        }
        _ => return None,
    }
    if i != b.len() {
        return None;
    }
    Some(((days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + s - offset) * 1000 + ms) as f64)
}

/// Vietnamese relative time; absolute dd/mm/yyyy from 30 days onward.
pub fn rel_date(iso: &str, now_ms: f64) -> String {
    let Some(ts) = iso_ms(iso) else { return String::new() };
    let diff = (now_ms - ts).max(0.0);
    if diff < 60_000.0 {
        return "vừa xong".into();
    }
    let mins = (diff / 60_000.0) as u64;
    if mins < 60 {
        return format!("{mins} phút trước");
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{hours} giờ trước");
    }
    let days = hours / 24;
    if days == 1 {
        return "hôm qua".into();
    }
    if days < 30 {
        return format!("{days} ngày trước");
    }
    fmt_date(iso)
}

/// Vietnamese label for a known MangaDex tag; unknown names pass through.
pub fn tag_label(en: &str) -> &str {
    match en {
        "Action" => "Hành động",
        "Adventure" => "Phiêu lưu",
        "Comedy" => "Hài hước",
        "Drama" => "Chính kịch",
        "Fantasy" => "Kỳ ảo",
        "Horror" => "Kinh dị",
        "Mystery" => "Bí ẩn",
        "Psychological" => "Tâm lý",
        "Romance" => "Lãng mạn",
        "Sci-Fi" => "Khoa học viễn tưởng",
        "Slice of Life" => "Đời thường",
        "Sports" => "Thể thao",
        "Supernatural" => "Siêu nhiên",
        "Thriller" => "Giật gân",
        "Tragedy" => "Bi kịch",
        "Historical" => "Lịch sử",
        "School" => "Học đường",
        "Military" => "Quân đội",
        "Police" => "Cảnh sát",
        "Superhero" => "Siêu anh hùng",
        "Ninja" => "Ninja",
        "Samurai" => "Samurai",
        "Mecha" => "Mecha",
        "Video Games" => "Trò chơi điện tử",
        "Yaoi" => "Yaoi",
        "Yuri" => "Yuri",
        other => other,
    }
}

fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Build the /search URL from filter state. Tags are comma-separated.
pub fn filter_url(q: &str, tags: &[String], status: &str, sort: &str, page: u32) -> String {
    let tags = tags.iter().map(|t| pct(t)).collect::<Vec<_>>().join(",");
    format!(
        "/search?q={}&tags={}&status={}&sort={}&page={}",
        pct(q),
        tags,
        pct(status),
        pct(sort),
        page.max(1)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-01-01T00:00:00Z
    const NOW: f64 = 1_767_225_600_000.0;
    const DAY: f64 = 86_400_000.0;

    #[test]
    fn rel_date_fixed_points() {
        assert_eq!(rel_date("2026-01-01T00:00:00Z", NOW), "vừa xong");
        assert_eq!(rel_date("2025-12-31T23:57:00Z", NOW), "3 phút trước");
        assert_eq!(rel_date("2025-12-31T19:00:00Z", NOW), "5 giờ trước");
        assert_eq!(rel_date("2025-12-31T00:00:00Z", NOW), "hôm qua");
        assert_eq!(rel_date("2025-12-23T00:00:00Z", NOW), "9 ngày trước");
        assert_eq!(rel_date("2025-11-22T00:00:00Z", NOW), "22/11/2025");
        assert_eq!(rel_date("", NOW), "");
    }

    #[test]
    fn rel_date_handles_offset_and_bad_input() {
        assert_eq!(rel_date("2026-01-01T07:00:00+07:00", NOW), "vừa xong");
        assert_eq!(rel_date("2025-12-31T17:00:00-07:00", NOW), "vừa xong");
        assert_eq!(rel_date("2026-01-01T00:00:00.123Z", NOW), "vừa xong");
        assert_eq!(rel_date("không phải ngày", NOW), "");
        assert_eq!(rel_date("2026-13-01T00:00:00Z", NOW), "");
    }

    #[test]
    fn rel_date_switches_to_absolute_at_30_days() {
        assert_eq!(rel_date("2025-12-03T00:00:00Z", NOW), "29 ngày trước");
        assert_eq!(rel_date("2025-12-02T00:00:00Z", NOW), "02/12/2025");
        assert_eq!(rel_date("2026-01-02T00:00:00Z", NOW), "vừa xong");
        assert_eq!(iso_ms("2025-12-23T00:00:00Z"), Some(NOW - 9.0 * DAY));
    }

    #[test]
    fn tag_label_maps_known_and_passes_unknown() {
        assert_eq!(tag_label("Action"), "Hành động");
        assert_eq!(tag_label("Slice of Life"), "Đời thường");
        assert_eq!(tag_label("Không biết"), "Không biết");
    }

    #[test]
    fn filter_url_keeps_all_fields_in_fixed_order() {
        assert_eq!(
            filter_url("One Piece", &[], "", "", 1),
            "/search?q=One%20Piece&tags=&status=&sort=&page=1"
        );
        assert_eq!(
            filter_url("", &["aaa".into(), "bbb".into()], "ongoing", "follows", 2),
            "/search?q=&tags=aaa,bbb&status=ongoing&sort=follows&page=2"
        );
        assert_eq!(
            filter_url("a&b", &[], "", "", 0),
            "/search?q=a%26b&tags=&status=&sort=&page=1"
        );
    }
}
