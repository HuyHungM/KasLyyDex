use crate::api::{chapter_label, get_json, Chapter, Chapters, MangaSummary, PagesRes};
use crate::{history, library, reader_settings};
use crate::views::LoadError;
use leptos::{ev, html, prelude::*};
use leptos_router::{components::A, hooks::{use_navigate, use_params_map, use_query_map}};
use send_wrapper::SendWrapper;
use std::{cell::Cell, rc::Rc};
use wasm_bindgen::{closure::Closure, JsCast};

#[component]
pub fn ReadPage() -> impl IntoView {
    let params = use_params_map();
    let query = use_query_map();
    let cid = Memo::new(move |_| params.read().get("chapter_id").unwrap_or_default());
    let manga_id = Memo::new(move |_| query.read().get("manga").unwrap_or_default());
    let lang = Memo::new(move |_| if query.read().get("lang").as_deref() == Some("en") { "en" } else { "vi" });
    let story = LocalResource::new(move || {
        let id = manga_id.get();
        async move {
            if id.is_empty() { return Err("Thiếu mã truyện. Hãy mở chương từ trang truyện.".to_owned()); }
            let path = format!("/api/manga/{id}");
            let feed = format!("{path}/chapters");
            let (manga, chapters) = futures::join!(get_json::<MangaSummary>(&path), get_json::<Chapters>(&feed));
            Ok((manga?, chapters?))
        }
    });
    view! {
        <Suspense fallback=move || view! { <p class="reader-loading" role="status">"Đang mở chương…"</p> }>
            {move || Suspend::new(async move {
                let language = lang.get();
                match story.await {
                    Ok((manga, chapters)) => {
                        let chapters = if language == "vi" { chapters.vi } else { chapters.en };
                        view! { <Reader manga=manga chapters=chapters lang=language cid=cid /> }.into_any()
                    }
                    Err(message) => view! { <main class="wrap"><LoadError message=message retry=Callback::new(move |_| story.refetch()) /><A href="/" attr:class="btn btn-ghost">"Về trang chủ"</A></main> }.into_any(),
                }
            })}
        </Suspense>
    }
}

#[component]
fn Reader(manga: MangaSummary, chapters: Vec<Chapter>, lang: &'static str, cid: Memo<String>) -> impl IntoView {
    let navigate = use_navigate();
    let mid = StoredValue::new(manga.id.clone());
    let href = move |id: &str| mid.with_value(|mid| format!("/read/{id}?manga={mid}&lang={lang}"));
    let chapters = StoredValue::new(chapters);
    let index = Memo::new(move |_| cid.with(|id| chapters.with_value(|list| list.iter().position(|c| &c.id == id))));
    let current = Memo::new(move |_| index.get().and_then(|i| chapters.with_value(|list| list.get(i).cloned())));
    let prev = Memo::new(move |_| index.get().and_then(|i| i.checked_sub(1)).and_then(|i| chapters.with_value(|list| list.get(i).map(|c| c.id.clone()))));
    let next = Memo::new(move |_| index.get().and_then(|i| chapters.with_value(|list| list.get(i + 1).map(|c| c.id.clone()))));
    let pages = LocalResource::new(move || {
        let id = cid.get();
        let external = current.get().and_then(|c| c.external_url);
        async move {
            let data = if external.is_some() { Ok(PagesRes { pages: Vec::new() }) }
                else { get_json::<PagesRes>(&format!("/api/chapter/{id}/pages")).await };
            (id, data)
        }
    });
    let total = Memo::new(move |_| pages.with(|p| p.as_ref().filter(|(id, _)| cid.with(|current| id == current))
        .and_then(|(_, data)| data.as_ref().ok()).map_or(0, |data| data.pages.len())));
    let position = RwSignal::new((String::new(), 0usize));
    let page = Memo::new(move |_| {
        let n = position.with(|(id, n)| if cid.with(|current| id == current) { *n } else { 0 });
        n.min(total.get().saturating_sub(1))
    });
    let set_page = move |n| position.set((cid.get_untracked(), n));
    let settings = RwSignal::new(reader_settings::get());
    let horizontal = Memo::new(move |_| settings.with(|s| s.mode == "horizontal"));
    let running = RwSignal::new(false);
    let root: NodeRef<html::Div> = NodeRef::new();
    let images: NodeRef<html::Div> = NodeRef::new();

    {
        let manga = manga.clone();
        Effect::new(move |_| {
            let id = cid.get();
            let saved = history::get_for(&manga.id).filter(|h| h.chapter_id == id)
                .and_then(|h| h.page).unwrap_or(1).saturating_sub(1);
            position.set((id, saved));
            running.set(false);
            scroll_top(root);
            if let Some(c) = current.get_untracked().filter(|c| c.external_url.is_none()) {
                history::push(&manga.id, &manga.title, manga.cover_file.clone(), lang, &c);
                library::set_last(&manga.id, &c.id, lang, js_sys::Date::parse(&c.publish_at));
            }
        });
    }
    Effect::new(move |_| {
        let n = total.get();
        let current_page = page.get();
        position.with(|(id, _)| {
            if n > 0 && cid.with(|current| id == current) {
                history::save_progress(id, current_page + 1, n);
            }
        });
    });
    let prefetched = StoredValue::new(String::new());
    Effect::new(move |_| {
        if total.get() > 0 {
            if let Some(id) = next.get() {
                if prefetched.with_value(|previous| previous != &id) {
                    prefetched.set_value(id.clone());
                    leptos::task::spawn_local(async move {
                        let _ = get_json::<PagesRes>(&format!("/api/chapter/{id}/pages")).await;
                    });
                }
            }
        }
    });

    let turn = move |direction| set_page(reader_settings::step_page(page.get_untracked(), total.get_untracked(), direction));
    {
        let navigate = navigate.clone();
        let key_listener = SendWrapper::new(window_event_listener(ev::keydown, move |event| {
            if event.alt_key() || event.ctrl_key() || event.meta_key() || event.shift_key() || event.default_prevented() {
                return;
            }
            if event.target().and_then(|el| el.dyn_into::<web_sys::Element>().ok())
                .is_some_and(|el| el.closest("input, select, textarea, button, [contenteditable]").ok().flatten().is_some()) {
                return;
            }
            let direction = match event.key().as_str() { "ArrowLeft" => -1, "ArrowRight" => 1, _ => return };
            if horizontal.get_untracked() {
                turn(direction);
                event.prevent_default();
            } else if let Some(id) = if direction < 0 { prev.get_untracked() } else { next.get_untracked() } {
                navigate(&href(&id), Default::default());
                event.prevent_default();
            }
        }));
        on_cleanup(move || key_listener.take().remove());
    }
    track_pages(images, horizontal, page, set_page);
    auto_scroll(running, settings, root);

    let select_chapter = move |event: ev::Event| {
        navigate(&href(&event_target_value(&event)), Default::default());
    };
    let back_href = mid.with_value(|id| format!("/manga/{id}"));
    let options = chapters.with_value(|list| list.iter().map(|c| {
        let id = c.id.clone();
        let selected = id.clone();
        view! { <option value=id selected=move || cid.with(|id| id == &selected)>{chapter_label(c)}</option> }
    }).collect::<Vec<_>>());
    let launch_fullscreen = move |_| {
        if document().fullscreen_element().is_some() { document().exit_fullscreen(); }
        else if let Some(element) = root.get_untracked() { let _ = element.request_fullscreen(); }
    };
    let pointer_start = StoredValue::new(None::<(i32, i32)>);

    view! {
        <div class="reader" data-bg=move || settings.with(|s| s.bg.clone()) node_ref=root
            on:wheel=move |_| running.set(false)>
            <header class="reader-bar">
                <div class="reader-bar-inner">
                    <A href=back_href attr:class="back-link">"← "{manga.title}</A>
                    <select class="chapter-select" aria-label="Chọn chương" prop:value=move || cid.get() on:change=select_chapter>{options}</select>
                    <ReaderControls settings=settings running=running />
                    {document().fullscreen_enabled().then(|| view! {
                        <button class="icon-btn fullscreen-button" type="button" aria-label="Đổi chế độ toàn màn hình" on:click=launch_fullscreen>
                            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4" /></svg>
                        </button>
                    })}
                </div>
            </header>
            <main class="reader-main" class:full-width=move || !settings.with(|s| s.fit) on:pointerdown=move |_| running.set(false)>
                <Suspense fallback=move || view! { <div class="reader-skel" role="status" aria-label="Đang tải trang"><div></div></div> }>
                    {move || Suspend::new(async move {
                        let (_, data) = pages.await;
                        match data {
                            Ok(data) if !data.pages.is_empty() => {
                                let data = StoredValue::new(data.pages);
                                view! {
                                    {move || if horizontal.get() {
                                        view! {
                                            <div class="reader-paged">
                                                <img class="reader-page" alt=move || format!("Trang {}", page.get() + 1)
                                                    src=move || data.with_value(|list| list.get(page.get()).cloned().unwrap_or_default())
                                                    draggable="false"
                                                    on:pointerdown=move |e: web_sys::PointerEvent| {
                                                        if !e.is_primary() { pointer_start.set_value(None); return; }
                                                        pointer_start.set_value(Some((e.client_x(), e.client_y())));
                                                    }
                                                    on:pointercancel=move |_| pointer_start.set_value(None)
                                                    on:pointerup=move |e: web_sys::PointerEvent| {
                                                        let Some((x, y)) = pointer_start.get_value() else { return };
                                                        pointer_start.set_value(None);
                                                        let dx = e.client_x() - x;
                                                        let dy = e.client_y() - y;
                                                        if dx.abs() >= 50 && dx.abs() > dy.abs() { turn(if dx < 0 { 1 } else { -1 }); }
                                                        else if dx.abs() < 12 && dy.abs() < 12 {
                                                            if let Some(el) = e.current_target().and_then(|el| el.dyn_into::<web_sys::Element>().ok()) {
                                                                let rect = el.get_bounding_client_rect();
                                                                let offset = f64::from(x) - rect.left();
                                                                if offset < rect.width() / 3.0 { turn(-1); }
                                                                else if offset > rect.width() * 2.0 / 3.0 { turn(1); }
                                                            }
                                                        }
                                                    }
                                                />
                                                <nav class="reader-paged-nav" aria-label="Lật trang">
                                                    <button class="nav-btn" type="button" disabled=move || page.get() == 0 on:click=move |_| turn(-1)>"← Trang trước"</button>
                                                    <button class="nav-btn" type="button" disabled={move || page.get() + 1 >= total.get()} on:click=move |_| turn(1)>"Trang sau →"</button>
                                                </nav>
                                            </div>
                                        }.into_any()
                                    } else {
                                        let eager = page.get_untracked();
                                        view! {
                                            <div class="reader-pages" node_ref=images>
                                                {data.with_value(|list| list.iter().enumerate().map(|(i, src)| view! {
                                                    <img class="reader-page" src=src.clone() data-index=i.to_string()
                                                        alt=format!("Trang {}", i + 1) loading=if i < 2 || i == eager { "eager" } else { "lazy" }
                                                        decoding="async" on:load=move |e| {
                                                            if let Some(img) = e.target().and_then(|el| el.dyn_into::<web_sys::Element>().ok()) {
                                                                let _ = img.set_attribute("data-loaded", "true");
                                                            }
                                                        } />
                                                }).collect::<Vec<_>>())}
                                            </div>
                                        }.into_any()
                                    }}
                                }.into_any()
                            }
                            Ok(_) => match current.get_untracked().and_then(|c| c.external_url) {
                                Some(url) => view! { <div class="panel"><p>"Chương này được đăng ở nguồn ngoài."</p><a class="text-link" href=url target="_blank" rel="noopener noreferrer">"Đọc tại nguồn ↗"</a></div> }.into_any(),
                                None => view! { <div class="panel">"Chương này chưa có ảnh."</div> }.into_any(),
                            },
                            Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| pages.refetch()) /> }.into_any(),
                        }
                    })}
                </Suspense>
            </main>
            <nav class="reader-bottom" aria-label="Điều hướng chương">
                <div class="reader-nav">
                    <ChapterControl target=prev href=Callback::new(move |id: String| href(&id)) label="← Chương trước" />
                    <span class="reader-page-count">{move || {
                        let n = total.get();
                        if n > 0 { format!("Trang {}/{n}", page.get() + 1) } else { "Trang —".to_owned() }
                    }}</span>
                    <ChapterControl target=next href=Callback::new(move |id: String| href(&id)) label="Chương sau →" primary=true />
                </div>
            </nav>
        </div>
    }
}

#[component]
fn ChapterControl(target: Memo<Option<String>>, href: Callback<String, String>, label: &'static str, #[prop(optional)] primary: bool) -> impl IntoView {
    move || match target.get() {
        Some(id) => view! { <A href=href.run(id) attr:class=if primary { "nav-btn primary" } else { "nav-btn" }>{label}</A> }.into_any(),
        None => view! { <span class="nav-btn disabled" aria-disabled="true">{label}</span> }.into_any(),
    }
}

#[component]
fn ReaderControls(settings: RwSignal<reader_settings::ReaderSettings>, running: RwSignal<bool>) -> impl IntoView {
    Effect::new(move |_| settings.with(reader_settings::save));
    view! {
        <details class="reader-settings">
            <summary>"Cài đặt"</summary>
            <div class="reader-settings-panel">
                <label>"Chế độ đọc"
                    <select prop:value=move || settings.with(|s| s.mode.clone()) on:change=move |e| {
                        running.set(false);
                        settings.update(|s| s.mode = event_target_value(&e));
                    }>
                        <option value="vertical" selected=move || settings.with(|s| s.mode == "vertical")>"Cuộn dọc"</option>
                        <option value="horizontal" selected=move || settings.with(|s| s.mode == "horizontal")>"Lật ngang"</option>
                    </select>
                </label>
                <label>"Nền đọc"
                    <select prop:value=move || settings.with(|s| s.bg.clone()) on:change=move |e| settings.update(|s| s.bg = event_target_value(&e))>
                        {[("light", "Sáng"), ("sepia", "Giấy ấm"), ("dark", "Tối")].into_iter().map(|(value, label)| view! {
                            <option value=value selected=move || settings.with(|s| s.bg == value)>{label}</option>
                        }).collect::<Vec<_>>()}
                    </select>
                </label>
                <button class="btn btn-ghost" type="button" aria-pressed=move || (!settings.with(|s| s.fit)).to_string()
                    on:click=move |_| settings.update(|s| s.fit = !s.fit)>
                    {move || if settings.with(|s| s.fit) { "Chiều rộng: Vừa khung" } else { "Chiều rộng: Tràn màn hình" }}
                </button>
                <Show when=move || settings.with(|s| s.mode == "vertical")>
                    <label>"Tốc độ tự cuộn"
                        <select prop:value=move || settings.with(|s| s.speed.to_string()) on:change=move |e| {
                            if let Ok(speed) = event_target_value(&e).parse::<u8>() { settings.update(|s| s.speed = speed.clamp(1, 5)); }
                        }>
                            {(1..=5).map(|speed| view! { <option value=speed selected=move || settings.with(|s| s.speed == speed)>{speed}</option> }).collect::<Vec<_>>()}
                        </select>
                    </label>
                    <button class="btn btn-primary" type="button" aria-pressed=move || running.get().to_string()
                        on:click=move |_| running.update(|active| *active = !*active)>
                        {move || if running.get() { "Dừng tự cuộn" } else { "Bật tự cuộn" }}
                    </button>
                </Show>
            </div>
        </details>
    }
}

fn track_pages(images: NodeRef<html::Div>, horizontal: Memo<bool>, page: Memo<usize>, set_page: impl Fn(usize) + Copy + 'static) {
    Effect::new(move |_| {
        if horizontal.get() { return; }
        let Some(container) = images.get() else { return };
        let saved = page.get_untracked();
        if saved > 0 {
            let selector = format!("img[data-index=\"{saved}\"]");
            if let Ok(Some(target)) = container.query_selector(&selector) { target.scroll_into_view(); }
        }
        let callback = Closure::<dyn FnMut(js_sys::Array, web_sys::IntersectionObserver)>::new(
            move |entries: js_sys::Array, _| {
                for value in entries.iter() {
                    let entry: web_sys::IntersectionObserverEntry = value.unchecked_into();
                    if !entry.is_intersecting() { continue; }
                    let scroll = document().fullscreen_element().map(|el| f64::from(el.scroll_top()))
                        .unwrap_or_else(|| window().scroll_y().unwrap_or_default());
                    if scroll < 1.0 {
                        set_page(0);
                        return;
                    }
                    if let Some(index) = entry.target().get_attribute("data-index").and_then(|index| index.parse().ok()) {
                        set_page(index);
                    }
                }
            },
        );
        let init = web_sys::IntersectionObserverInit::new();
        let height = window().inner_height().ok().and_then(|value| value.as_f64()).unwrap_or(700.0);
        let line = (height * 0.25).floor();
        init.set_root_margin(&format!("-{line}px 0px -{}px 0px", (height - line - 2.0).max(0.0)));
        if let (Ok(observer), Ok(elements)) = (web_sys::IntersectionObserver::new_with_options(callback.as_ref().unchecked_ref(), &init), container.query_selector_all("img")) {
            for i in 0..elements.length() {
                if let Some(element) = elements.item(i).and_then(|el| el.dyn_into::<web_sys::Element>().ok()) { observer.observe(&element); }
            }
            let state = SendWrapper::new((observer, callback));
            on_cleanup(move || {
                let (observer, _callback) = state.take();
                observer.disconnect();
            });
        }
    });
}

fn scroll_top(root: NodeRef<html::Div>) {
    if let Some(element) = document().fullscreen_element().and_then(|_| root.get_untracked()) {
        element.set_scroll_top(0);
    } else { window().scroll_to_with_x_and_y(0.0, 0.0); }
}

fn auto_scroll(running: RwSignal<bool>, settings: RwSignal<reader_settings::ReaderSettings>, root: NodeRef<html::Div>) {
    Effect::new(move |_| {
        if !running.get() { return; }
        let speed = settings.with(|s| f64::from(s.speed) * 28.0);
        let last_time = Cell::new(None::<f64>);
        let carry = Cell::new(0.0_f64);
        let frame = Rc::new(Cell::new(0));
        let next_frame = Rc::clone(&frame);
        let callback: Rc<Closure<dyn FnMut(f64)>> = Rc::new_cyclic(|weak: &std::rc::Weak<Closure<dyn FnMut(f64)>>| {
            let weak = weak.clone();
            Closure::new(move |now: f64| {
                if !running.get_untracked() { return; }
                if let Some(last) = last_time.replace(Some(now)) {
                    let distance = carry.get() + (now - last).min(50.0) * speed / 1000.0;
                    let pixels = distance.floor();
                    carry.set(distance - pixels);
                    if pixels > 0.0 {
                        let moved = if let Some(element) = document().fullscreen_element().and_then(|_| root.get_untracked()) {
                            let top = element.scroll_top();
                            element.set_scroll_top(top + pixels as i32);
                            element.scroll_top() > top
                        } else {
                            let top = window().scroll_y().unwrap_or_default();
                            window().scroll_by_with_x_and_y(0.0, pixels);
                            window().scroll_y().unwrap_or_default() > top
                        };
                        if !moved { running.set(false); return; }
                    }
                }
                if let Some(callback) = weak.upgrade() {
                    if let Ok(id) = window().request_animation_frame(callback.as_ref().as_ref().unchecked_ref()) { next_frame.set(id); }
                }
            })
        });
        if let Ok(id) = window().request_animation_frame(callback.as_ref().as_ref().unchecked_ref()) { frame.set(id); }
        let state = SendWrapper::new((frame, callback));
        on_cleanup(move || {
            let (frame, _callback) = state.take();
            let _ = window().cancel_animation_frame(frame.get());
        });
    });
}
