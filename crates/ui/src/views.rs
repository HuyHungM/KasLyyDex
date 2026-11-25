use crate::api::*;
use crate::catalog::{Genres, Ranking, Search};
use crate::history;
use crate::home::Home;
use crate::library_view::LibraryPage;
use crate::manga::MangaPage;
use crate::reader::ReadPage;
use leptos::prelude::*;
use leptos_router::components::{A, Route, Router, Routes};
use leptos_router::hooks::{use_location, use_navigate, use_query_map};
use leptos_router::path;

#[component]
pub fn App() -> impl IntoView {
    view! {
        <Router>
            <Shell />
        </Router>
    }
}

#[derive(Clone, Copy)]
pub struct LibraryUpdates(pub RwSignal<bool>);

#[component]
fn Shell() -> impl IntoView {
    let location = use_location();
    let reading = move || location.pathname.get().starts_with("/read/");
    provide_context(LibraryUpdates(RwSignal::new(false)));
    view! {
        <div class="site-shell" class:reading=reading>
            <Show when=move || !reading()><DesktopNav /></Show>
            <div class="site-content">
              <Show when=move || !reading()><Header /></Show>
              <div class="flex-1" id="noi-dung">
                <Routes fallback=|| view! { <NotFound /> }>
                    <Route path=path!("/") view=Home />
                    <Route path=path!("/search") view=Search />
                    <Route path=path!("/manga/:id") view=MangaPage />
                    <Route path=path!("/read/:chapter_id") view=ReadPage />
                    <Route path=path!("/the-loai") view=Genres />
                    <Route path=path!("/bxh") view=Ranking />
                    <Route path=path!("/tu-truyen") view=LibraryPage />
                </Routes>
              </div>
              <Show when=move || !reading()>
                  <footer class="site-footer">
                    <span class="footer-brand">"KasLyyDex"</span>
                    <p>"Dữ liệu và ảnh từ "<a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">"MangaDex"</a>". Ủng hộ tác giả bằng cách mua truyện bản quyền."</p>
                  </footer>
              </Show>
            </div>
            <Show when=move || !reading()><nav class="bottom-tabs" aria-label="Điều hướng trên điện thoại"><NavLinks /></nav></Show>
        </div>
    }
}

#[component]
fn Brand() -> impl IntoView {
    view! {
        <A href="/" attr:class="logo">
            <span class="logo-mark"><Icon name=Signal::derive(|| "book") /></span>
            <span>"KasLyy"<b>"Dex"</b></span>
        </A>
    }
}

#[component]
fn DesktopNav() -> impl IntoView {
    view! {
        <aside class="site-rail">
            <Brand />
            <nav class="nav-links" aria-label="Điều hướng chính"><NavLinks /></nav>
            <div class="rail-source">
                <span>"NGUỒN TRUYỆN"</span>
                <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">"MangaDex ↗"</a>
            </div>
        </aside>
    }
}

#[component]
fn Header() -> impl IntoView {
    let navigate = use_navigate();
    let query = use_query_map();
    let q = RwSignal::new(query.get().get("q").unwrap_or_default());
    Effect::new(move |_| q.set(query.get().get("q").unwrap_or_default()));
    let dark = RwSignal::new(document().document_element().and_then(|el| el.get_attribute("data-theme")).as_deref() != Some("light"));
    let toggle_theme = move |_| {
        let value = !dark.get_untracked();
        let theme = if value { "dark" } else { "light" };
        if let Some(root) = document().document_element() {
            let _ = root.set_attribute("data-theme", theme);
        }
        if let Ok(Some(storage)) = window().local_storage() {
            let _ = storage.set_item("truyenviet:theme", theme);
        }
        dark.set(value);
    };
    let submit = move |ev: leptos::ev::SubmitEvent| {
        ev.prevent_default();
        let text = q.get().trim().to_string();
        let target = if text.is_empty() { "/search".to_owned() } else {
            format!("/search?q={}", js_sys::encode_uri_component(&text).as_string().unwrap_or_default())
        };
        navigate(&target, Default::default());
    };
    view! {
        <header class="site-header">
            <div class="header-inner">
                <div class="mobile-brand"><Brand /></div>
                <form class="search-form" role="search" on:submit=submit>
                    <input
                        class="search-input"
                        placeholder="Nhập tên truyện…"
                        type="search"
                        maxlength="200"
                        aria-label="Tìm truyện"
                        prop:value=move || q.get()
                        on:input=move |ev| q.set(event_target_value(&ev))
                    />
                    <button type="submit" class="search-btn" aria-label="Tìm kiếm">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="m20 20-3.5-3.5"></path>
                        </svg>
                    </button>
                </form>
                <button class="icon-btn theme-btn" type="button" aria-label=move || if dark.get() { "Bật giao diện sáng" } else { "Bật giao diện tối" } on:click=toggle_theme>
                    <Icon name=Signal::derive(move || if dark.get() { "sun" } else { "moon" }) />
                </button>
            </div>
        </header>
    }
}

#[component]
fn NavLinks() -> impl IntoView {
    let updates = expect_context::<LibraryUpdates>().0;
    view! {
        <A href="/" exact=true><Icon name=Signal::derive(|| "home") />"Trang chủ"</A>
        <A href="/search" attr:class="desktop-discover"><Icon name=Signal::derive(|| "search") />"Khám phá"</A>
        <A href="/the-loai"><Icon name=Signal::derive(|| "genres") />"Thể loại"</A>
        <A href="/bxh"><Icon name=Signal::derive(|| "rank") />"Xếp hạng"</A>
        <A href="/tu-truyen"><Icon name=Signal::derive(|| "bookmark") />"Tủ truyện"
            <Show when=move || updates.get()><span class="tab-dot" aria-label="Có chương mới"></span></Show>
        </A>
    }
}

#[component]
fn Icon(#[prop(into)] name: Signal<&'static str>) -> impl IntoView {
    view! {
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d=move || match name.get() {
                "home" => "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
                "book" => "M12 5v15M3 4h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v14h-4a6 6 0 0 0-5 2 6 6 0 0 0-5-2H3z",
                "search" => "M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0z m-2 6 5 5",
                "genres" => "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
                "rank" => "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 5 M17 6h3a3 3 0 0 1-3 5 M12 14v6m-4 0h8",
                "bookmark" => "M6 4h12v16l-6-4-6 4z",
                "sun" => "M16 12a4 4 0 1 0-8 0 4 4 0 1 0 8 0z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19",
                _ => "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z",
            } />
        </svg>
    }
}

#[component]
pub fn SectionTitle(children: Children) -> impl IntoView {
    view! {
        <div class="section-title">
            <h2>{children()}</h2>
        </div>
    }
}

#[component]
pub fn MangaCard(manga: MangaSummary, #[prop(optional)] rank: Option<usize>) -> impl IntoView {
    let cover = cover_url(&manga, 256).map(|u| proxy(&u));
    let has_status = !manga.status.is_empty();
    let badge = status_text(&manga.status).to_string();
    let year = manga.year;
    let href = format!("/manga/{}", manga.id);
    let card_title = manga.title.clone();
    view! {
        <A href=href attr:class="card">
            <div class="card-cover">
                {match cover {
                    Some(src) => view! { <img src=src alt="" loading="lazy" decoding="async" /> }.into_any(),
                    None => view! { <div class="no-cover" aria-hidden="true">"Chưa có bìa"</div> }.into_any(),
                }}
                {rank.map(|n| view! { <span class="rank-num">{n}</span> })}
            </div>
            <h3 class="card-title">{card_title}</h3>
            <p class="card-year">
                {manga.rating.filter(|r| *r > 0.0).map(|r| format!("★ {r:.1} · "))}
                {if let Some(chapter) = manga.latest_chapter { chapter_name(Some(&chapter)) }
                    else if has_status { badge } else { year.map(|y| y.to_string()).unwrap_or_default() }}
            </p>
        </A>
    }
}

pub fn grid(list: Vec<MangaSummary>) -> impl IntoView {
    if list.is_empty() {
        return view! { <p class="empty">"Không có truyện nào."</p> }.into_any();
    }
    view! {
        <div class="manga-grid">
            {list.into_iter().map(|m| view! { <MangaCard manga=m /> }).collect::<Vec<_>>()}
        </div>
    }
    .into_any()
}

pub fn skeleton() -> impl IntoView {
    view! {
        <div class="manga-grid">
            {(0..6).map(|_| view! {
                <div class="skel">
                    <div class="skel-cover"></div>
                    <div class="skel-line"></div>
                </div>
            }).collect::<Vec<_>>()}
        </div>
    }
}

#[component]
pub fn LoadError(message: String, retry: Callback<()>) -> impl IntoView {
    view! {
        <div class="empty" role="alert">
            <p>{message}</p>
            <button class="btn btn-ghost" type="button" on:click=move |_| retry.run(())>"Thử lại"</button>
        </div>
    }
}

#[component]
pub fn ContinueReading() -> impl IntoView {
    let list = history::get_history().into_iter().take(6).collect::<Vec<_>>();
    if list.is_empty() {
        return view! { <span></span> }.into_any();
    }
    view! {
        <section class="section">
            <SectionTitle>"Đọc tiếp"</SectionTitle>
                <div class="continue-grid">
                {list.into_iter().map(|h| {
                    let cover = h.cover_file.as_ref().map(|f| proxy(&format!("https://uploads.mangadex.org/covers/{}/{}.256.jpg", h.manga_id, f)));
                    let href = format!("/read/{}?manga={}&lang={}", h.chapter_id, h.manga_id, h.lang);
                    let label = h.chapter.clone().map(|c| format!("Chương {c}")).unwrap_or_else(|| "Truyện ngắn".into());
                    let title = h.manga_title.clone();
                    view! {
                        <A href=href attr:class="continue-card">
                            <div class="continue-cover">
                                {cover.map(|src| view! { <img src=src alt="" loading="lazy" decoding="async" /> })}
                            </div>
                            <div class="continue-meta">
                                <p class="cc-title">{title}</p>
                                <p class="cc-ch">{label}</p>
                                {h.total.filter(|total| *total > 0).map(|total| view! {
                                    <progress aria-label="Tiến độ đọc chương" max=total value=h.page.unwrap_or(1)></progress>
                                })}
                            </div>
                        </A>
                    }
                }).collect::<Vec<_>>()}
            </div>
        </section>
    }
    .into_any()
}

#[component]
fn NotFound() -> impl IntoView {
    view! {
        <main class="nf">
            <h1>"404 — Không tìm thấy"</h1>
            <p>"Không tìm thấy trang, truyện hoặc chương bạn muốn mở."</p>
            <A href="/" attr:class="btn btn-primary">"Về trang chủ"</A>
        </main>
    }
}
