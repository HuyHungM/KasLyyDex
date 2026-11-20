use crate::api::*;
use crate::history;
use crate::library_view::FollowButton;
use crate::views::{LoadError, SectionTitle};
use leptos::prelude::*;
use leptos_router::{components::A, hooks::use_params_map};

#[component]
pub fn MangaPage() -> impl IntoView {
    let params = use_params_map();
    let id = RwSignal::new(String::new());
    Effect::new(move |_| id.set(params.get().get("id").unwrap_or_default()));
    let res: LocalResource<Result<(MangaSummary, Chapters), String>> = LocalResource::new(move || {
        let id = id.get();
        async move {
            let u1 = format!("/api/manga/{id}");
            let u2 = format!("/api/manga/{id}/chapters");
            let (m, c) = futures::join!(get_json::<MangaSummary>(&u1), get_json::<Chapters>(&u2));
            Ok((m?, c?))
        }
    });
    view! {
        <Suspense fallback=move || view! {
            <main class="wrap"><div class="manga-head skel-head"><div class="skel-cover big"></div><div class="skel-info"><div class="skel-line w60"></div><div class="skel-line w30"></div><div class="skel-line w90"></div></div></div></main>
        }>
            {move || Suspend::new(async move {
                match res.await {
                    Ok((m, c)) => {
                        let lang = if c.vi.iter().any(|ch| ch.external_url.is_none()) { "vi" } else { "en" };
                        let list = if lang == "vi" { &c.vi } else { &c.en };
                        let first = list.iter().find(|ch| ch.external_url.is_none()).cloned();
                        let resume = history::get_for(&m.id);
                        let cover = cover_url(&m, 512).map(|u| proxy(&u));
                        let mid = m.id.clone();
                        let read_href = first.as_ref().map(|f| format!("/read/{}?manga={}&lang={lang}", f.id, m.id));
                        let read_label = first.as_ref().map(chapter_label).unwrap_or_default();
                        let has_external = !list.is_empty();
                        let count_label = format!("{} chương ({})", list.len(), if lang == "vi" { "tiếng Việt" } else { "tiếng Anh" });
                        let title = m.title.clone();
                        let alt = m.title.clone();
                        let author = m.author.clone();
                        let has_author = !author.is_empty();
                        let status = status_text(&m.status).to_string();
                        let has_status = !m.status.is_empty();
                        let year = m.year;
                        let desc = m.description.clone();
                        let has_desc = !desc.is_empty();
                        let has_tags = !m.tags.is_empty();
                        let tags = m.tags.clone();
                        let tag_ids = m.tag_ids.clone();
                        let resume_view = resume.map(|h| {
                            let label = chapter_name(h.chapter.as_deref());
                            let href = format!("/read/{}?manga={}&lang={}", h.chapter_id, mid, h.lang);
                            view! { <A href=href attr:class="btn btn-ghost">{format!("Đọc tiếp · {label}")}</A> }
                        });
                        view! {
                            <main class="wrap manga-page">
                                <A href="/search" attr:class="back-link">"← Khám phá truyện"</A>
                                <div class="surface manga-head">
                                    <div class="manga-cover">
                                        {cover.map(|src| view! { <img src=src alt=alt decoding="async" /> })}
                                    </div>
                                    <div class="manga-info">
                                        <h1 class="manga-title">{title}</h1>
                                        <p class="meta-row">
                                            {if has_author { Some(view! { <span>"Tác giả: "<b>{author}</b></span> }) } else { None }}
                                            {if has_status { Some(view! { <span class="accent">{status}</span> }) } else { None }}
                                            {year.map(|y| view! { <span>{y}</span> })}
                                            <span>{count_label}</span>
                                            {m.rating.filter(|r| *r > 0.0).map(|r| view! { <span class="stat-chip">{format!("★ {r:.1}")}</span> })}
                                            {m.follows.map(|n| view! { <span class="stat-chip">{format!("{n} theo dõi")}</span> })}
                                        </p>
                                        <Show when=move || has_tags>
                                            <div class="tags">
                                                {tags.iter().zip(tag_ids.iter()).take(12).map(|(tag, id)| {
                                                    let href = filter_url("", std::slice::from_ref(id), "", "follows", 1);
                                                    let label = tag_label(tag).to_owned();
                                                    view! { <A href=href attr:class="tag">{label}</A> }
                                                }).collect::<Vec<_>>()}
                                            </div>
                                        </Show>
                                        {if has_desc { Some(view! { <p class="desc">{desc}</p> }) } else { None }}
                                        <div class="actions">
                                            {match read_href {
                                                Some(href) => view! { <A href=href attr:class="btn btn-primary">{format!("Đọc từ đầu · {read_label}")}</A> }.into_any(),
                                                None => view! { <span class="btn btn-disabled">{if has_external { "Chỉ có chương ở nguồn ngoài" } else { "Chưa có chương" }}</span> }.into_any(),
                                            }}
                                            {resume_view}
                                            <FollowButton manga_id=m.id.clone() title=m.title.clone() cover_file=m.cover_file.clone() lang=lang.to_owned() />
                                        </div>
                                    </div>
                                </div>
                                <section class="surface chapters-panel">
                                    <SectionTitle>"Danh sách chương"</SectionTitle>
                                    <ChapterList manga_id=m.id.clone() chapters=c />
                                </section>
                            </main>
                        }.into_any()
                    }
                    Err(message) => view! { <main class="wrap"><LoadError message=message retry=Callback::new(move |_| res.refetch()) /></main> }.into_any(),
                }
            })}
        </Suspense>
    }
}

#[component]
fn ChapterList(manga_id: String, chapters: Chapters) -> impl IntoView {
    let has_vi = !chapters.vi.is_empty();
    let has_en = !chapters.en.is_empty();
    let lang = RwSignal::new(if has_vi { "vi".to_string() } else { "en".to_string() });
    let last_read = history::get_for(&manga_id).and_then(|h| Some((h.lang, h.chapter?.parse::<f64>().ok()?)));
    if !has_vi && !has_en {
        return view! { <p class="empty">"Truyện chưa có chương tiếng Việt hoặc tiếng Anh."</p> }.into_any();
    }
    let rows = move || {
        let l = lang.get();
        let mut list = if l == "vi" { chapters.vi.clone() } else { chapters.en.clone() };
        list.reverse();
        list.into_iter().map(|c| {
            let read = last_read.as_ref().filter(|(language, _)| language == &l)
                .zip(c.chapter.as_ref().and_then(|n| n.parse::<f64>().ok())).is_some_and(|((_, last), n)| n <= *last);
            let label = chapter_label(&c);
            let date = rel_date(&c.publish_at, js_sys::Date::now());
            let title = if c.title.is_empty() { c.group.clone() } else { c.title.clone() };
            let shown = if title.is_empty() { "—".to_string() } else { title.clone() };
            match &c.external_url {
                Some(u) => {
                    let ext_title = if title.is_empty() { "Đọc tại nguồn ngoài".to_string() } else { title };
                    view! {
                        <li>
                            <a href=u.clone() target="_blank" rel="noopener noreferrer" class="chapter-row">
                                <span class="ch-num read">{label}</span>
                                <span class="ch-title read">{ext_title} " ↗"</span>
                                <span class="ch-date">{date}</span>
                            </a>
                        </li>
                    }.into_any()
                }
                None => {
                    let href = format!("/read/{}?manga={}&lang={l}", c.id, manga_id);
                    let mark = if read { " ✓" } else { "" };
                    view! {
                        <li>
                            <A href=href attr:class="chapter-row">
                                <span class=if read { "ch-num read" } else { "ch-num" }>{label}{mark}</span>
                                <span class=if read { "ch-title read" } else { "ch-title" }>{shown}</span>
                                <span class="ch-date">{date}</span>
                            </A>
                        </li>
                    }.into_any()
                }
            }
        }).collect::<Vec<_>>()
    };
    view! {
        <Show when=move || has_vi && has_en>
            <div class="lang-tabs">
                <button class="lang-tab" aria-pressed=move || (lang.get() == "vi").to_string() on:click=move |_| lang.set("vi".into())>"Tiếng Việt"</button>
                <button class="lang-tab" aria-pressed=move || (lang.get() == "en").to_string() on:click=move |_| lang.set("en".into())>"Tiếng Anh"</button>
            </div>
        </Show>
        <ul class="chapter-list">{rows}</ul>
    }
    .into_any()
}
