use crate::api::{get_json, Chapters, LatestManga};
use crate::library::{self, LibraryEntry};
use crate::views::LibraryUpdates;
use futures::{stream, StreamExt};
use leptos::prelude::*;
use leptos_router::components::A;

pub fn merge_feed_updates(feed: &[LatestManga], updates: RwSignal<bool>) {
    if library::get().iter().any(|entry| feed.iter().any(|item| {
        item.manga.id == entry.manga_id && item.chapters.iter().any(|c| c.lang == entry.lang
            && entry.has_update(&c.id, js_sys::Date::parse(&c.publish_at)))
    })) {
        updates.set(true);
    }
}

#[component]
pub fn FollowButton(manga_id: String, title: String, cover_file: Option<String>, lang: String) -> impl IntoView {
    let followed = RwSignal::new(library::get().iter().any(|e| e.manga_id == manga_id));
    let failed = RwSignal::new(false);
    view! {
        <div class="follow-control">
            <button class="btn btn-ghost" aria-pressed=move || followed.get().to_string() on:click=move |_| {
                let active = followed.get_untracked();
                let saved = if active { library::remove(&manga_id) }
                    else { library::add(&manga_id, &title, cover_file.clone(), &lang) };
                failed.set(!saved);
                if saved { followed.set(!active); }
            }>{move || if followed.get() { "✓ Đang theo dõi" } else { "+ Theo dõi" }}</button>
            <Show when=move || failed.get()><small role="alert">"Trình duyệt không lưu được tủ truyện."</small></Show>
        </div>
    }
}

#[component]
pub fn ShelfPreview() -> impl IntoView {
    let entries = library::get();
    view! {
        <section class="surface">
            <div class="panel-heading"><h2>"Tủ truyện"</h2><A href="/tu-truyen" attr:class="text-link">"Mở tủ →"</A></div>
            <div class="shelf-preview">
                {if entries.is_empty() {
                    view! { <p>"Bấm Theo dõi ở trang truyện để lưu vào tủ."</p><A href="/search" attr:class="btn btn-ghost">"Khám phá truyện"</A> }.into_any()
                } else {
                    view! { <ul>{entries.into_iter().take(4).map(|entry| view! { <li><A href=format!("/manga/{}", entry.manga_id)>{entry.title}</A></li> }).collect::<Vec<_>>()}</ul> }.into_any()
                }}
            </div>
        </section>
    }
}

#[component]
pub fn LibraryPage() -> impl IntoView {
    let entries = RwSignal::new(library::get());
    let dot = expect_context::<LibraryUpdates>().0;
    let retry = RwSignal::new(0u32);
    let checks = LocalResource::new(move || {
        retry.get();
        let entries = entries.get_untracked();
        async move {
            stream::iter(entries).map(|entry| async move {
                let result = get_json::<Chapters>(&format!("/api/manga/{}/chapters", entry.manga_id)).await
                    .map(|chapters| {
                        let list = if entry.lang == "en" { chapters.en } else { chapters.vi };
                        list.into_iter().filter(|c| c.external_url.is_none() && c.pages > 0)
                            .filter_map(|c| {
                                let published = js_sys::Date::parse(&c.publish_at);
                                published.is_finite().then_some((c, published))
                            }).max_by(|a, b| a.1.total_cmp(&b.1))
                            .filter(|(c, published)| entry.has_update(&c.id, *published))
                            .map(|(c, _)| c)
                    });
                (entry.manga_id, result)
            }).buffer_unordered(4).collect::<Vec<_>>().await
        }
    });
    Effect::new(move |_| {
        let saved = entries.get();
        if let Some(results) = checks.get() {
            dot.set(results.iter().any(|(id, result)| matches!(result, Ok(Some(_))) && saved.iter().any(|e| &e.manga_id == id)));
        }
    });
    let failed = RwSignal::new(false);
    view! {
        <main class="wrap catalog-page">
            <div class="page-intro"><div><h1>"Tủ truyện"</h1><p>"Truyện theo dõi được lưu trên trình duyệt này."</p></div>
                <A href="/search" attr:class="btn btn-ghost">"Khám phá truyện →"</A>
            </div>
            <Show when=move || failed.get()><p role="alert">"Trình duyệt không lưu được thay đổi."</p></Show>
            <Show when=move || checks.with(|result| result.as_ref().is_some_and(|r| r.iter().any(|(_, r)| r.is_err())))>
                <div class="surface status-note" role="status">"Chưa kiểm tra được một số truyện."
                    <button type="button" class="btn btn-ghost" on:click=move |_| retry.update(|n| *n += 1)>"Thử lại"</button>
                </div>
            </Show>
            {move || {
                let list = entries.get();
                if list.is_empty() {
                    return view! { <div class="surface empty"><h2>"Tủ truyện đang trống"</h2><p>"Chọn Theo dõi ở trang truyện để lưu vào đây."</p></div> }.into_any();
                }
                view! {
                    <div class="shelf-grid">
                        {list.into_iter().map(|entry: LibraryEntry| {
                            let id = StoredValue::new(entry.manga_id);
                            let cover = entry.cover_file.map(|file| id.with_value(|id| crate::api::proxy(&format!("https://uploads.mangadex.org/covers/{id}/{file}.256.jpg"))));
                            view! {
                                <article class="surface shelf-card">
                                    <A href=id.with_value(|id| format!("/manga/{id}")) attr:class="shelf-story">
                                        <span class="feed-cover">{cover.map(|src| view! { <img src=src alt="" loading="lazy" /> })}</span>
                                        <strong>{entry.title}</strong>
                                    </A>
                                    {move || checks.with(|results| {
                                        let results = results.as_ref()?;
                                        let (_, Ok(Some(chapter))) = results.iter().find(|(mid, _)| id.with_value(|id| id == mid))? else { return None };
                                        let href = id.with_value(|id| format!("/read/{}?manga={id}&lang={}", chapter.id, chapter.lang));
                                        let label = crate::api::chapter_label(chapter);
                                        Some(view! { <A href=href attr:class="chapter-pill fresh">"Chương mới · "{label}</A> })
                                    })}
                                    <button type="button" class="btn btn-ghost" on:click=move |_| {
                                        let saved = id.with_value(|id| library::remove(id));
                                        failed.set(!saved);
                                        if saved { entries.set(library::get()); }
                                    }>"Bỏ theo dõi"</button>
                                </article>
                            }
                        }).collect::<Vec<_>>()}
                    </div>
                }.into_any()
            }}
        </main>
    }
}
