use crate::api::*;
use crate::views::{grid, skeleton, LoadError};
use leptos::prelude::*;
use leptos_router::components::A;
use leptos_router::hooks::{use_navigate, use_query_map};

const SORTS: [(&str, &str); 5] = [
    ("follows", "Lượt theo dõi"), ("rating", "Điểm đánh giá"), ("new", "Cập nhật gần đây"),
    ("year", "Năm phát hành"), ("title", "Tên A–Z"),
];

#[derive(Clone, PartialEq)]
struct Filters {
    title: String,
    tags: Vec<String>,
    status: String,
    sort: String,
    page: u32,
}

impl Filters {
    fn url(&self, page: u32) -> String {
        filter_url(&self.title, &self.tags, &self.status, &self.sort, page)
    }
}

#[component]
pub fn Search() -> impl IntoView {
    let query = use_query_map();
    let filters = Memo::new(move |_| {
        let query = query.read();
        Filters {
            title: query.get("q").unwrap_or_default(),
            tags: query.get("tags").unwrap_or_default().split(',').filter(|tag| !tag.is_empty()).map(str::to_owned).collect(),
            status: query.get("status").unwrap_or_default(),
            sort: query.get("sort").filter(|s| !s.is_empty()).unwrap_or_else(|| "follows".into()),
            page: query.get("page").and_then(|s| s.parse().ok()).unwrap_or(1),
        }
    });
    let results = LocalResource::new(move || {
        let f = filters.get();
        async move { get_json::<SearchRes>(&format!("/api{}", f.url(f.page))).await }
    });
    view! {
        <main class="wrap catalog-page">
            <div class="page-intro"><div><h1>"Khám phá truyện"</h1><p>"Lọc theo thể loại, trạng thái hoặc cách sắp xếp."</p></div></div>
            <SearchFilters filters=filters />
            <Suspense fallback=move || skeleton()>
                {move || Suspend::new(async move {
                    let f = filters.get();
                    match results.await {
                        Err(message) => view! {
                            <LoadError message=message retry=Callback::new(move |_| results.refetch()) />
                            <A href="/search" attr:class="btn btn-ghost">"Xóa bộ lọc"</A>
                        }.into_any(),
                        Ok(r) if r.results.is_empty() => view! {
                            <div class="surface empty">
                                <h2>"Không tìm thấy truyện"</h2><p>"Thử tên khác hoặc bỏ bớt bộ lọc."</p>
                                <A href=filter_url(&f.title, &[], "", "follows", 1) attr:class="btn btn-ghost">"Xóa bộ lọc"</A>
                            </div>
                        }.into_any(),
                        Ok(r) => {
                            let pages = r.total.div_ceil(24).min(416) as u32;
                            let label = if f.title.is_empty() { format!("{} truyện", r.total) } else { format!("{} kết quả cho “{}”", r.total, f.title) };
                            view! {
                                <p class="result-info">{label}</p>
                                {grid(r.results)}
                                {(pages > 1).then(|| view! {
                                    <nav class="pagination" aria-label="Trang kết quả">
                                        {(f.page > 1).then(|| view! { <A href=f.url(f.page - 1) attr:class="nav-btn">"← Trước"</A> })}
                                        <span class="page-info">{format!("Trang {}/{pages}", f.page)}</span>
                                        {(f.page < pages).then(|| view! { <A href=f.url(f.page + 1) attr:class="nav-btn">"Sau →"</A> })}
                                    </nav>
                                })}
                            }.into_any()
                        }
                    }
                })}
            </Suspense>
        </main>
    }
}

#[component]
fn SearchFilters(filters: Memo<Filters>) -> impl IntoView {
    let nav = use_navigate();
    let draft = RwSignal::new(filters.get_untracked());
    let tags = LocalResource::new(|| get_json::<Vec<Tag>>("/api/tags"));
    Effect::new(move |_| draft.set(filters.get()));
    view! {
        <details class="surface search-filters">
            <summary>{move || {
                let f = filters.get();
                let count = f.tags.len() + usize::from(!f.status.is_empty()) + usize::from(f.sort != "follows");
                if count == 0 { "Bộ lọc".into() } else { format!("Bộ lọc ({count})") }
            }}</summary>
            <form on:submit=move |event| { event.prevent_default(); nav(&draft.get_untracked().url(1), Default::default()); }>
                <div class="filter-fields">
                    <label>"Trạng thái"
                        <select prop:value=move || draft.get().status on:change=move |e| draft.update(|f| f.status = event_target_value(&e))>
                            <option value="">"Tất cả"</option>
                            {["ongoing", "completed", "hiatus", "cancelled"].into_iter().map(|s| view! {
                                <option value=s selected=move || draft.get().status == s>{status_text(s)}</option>
                            }).collect::<Vec<_>>()}
                        </select>
                    </label>
                    <label>"Sắp xếp"
                        <select prop:value=move || draft.get().sort on:change=move |e| draft.update(|f| f.sort = event_target_value(&e))>
                            {SORTS.into_iter().map(|(s, label)| view! {
                                <option value=s selected=move || draft.get().sort == s>{label}</option>
                            }).collect::<Vec<_>>()}
                        </select>
                    </label>
                </div>
                <fieldset class="filter-tags">
                    <legend>{move || format!("Thể loại ({}/8)", draft.get().tags.len())}</legend>
                    <Suspense fallback=move || view! { <p role="status">"Đang tải thể loại…"</p> }>
                        {move || Suspend::new(async move {
                            match tags.await {
                                Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| tags.refetch()) /> }.into_any(),
                                Ok(mut list) => {
                                    list.sort_by(|a, b| tag_label(&a.name).cmp(tag_label(&b.name)));
                                    view! { <div class="tag-options">
                                        {list.into_iter().map(|tag| {
                                            let id = StoredValue::new(tag.id);
                                            view! {
                                                <label class="filter-tag">
                                                    <input type="checkbox"
                                                        prop:checked=move || draft.with(|f| id.with_value(|id| f.tags.contains(id)))
                                                        disabled=move || draft.with(|f| f.tags.len() >= 8 && !id.with_value(|id| f.tags.contains(id)))
                                                        on:change=move |e| draft.update(|f| {
                                                            let id = id.get_value();
                                                            if event_target_checked(&e) && f.tags.len() < 8 { f.tags.push(id); }
                                                            else { f.tags.retain(|tag| tag != &id); }
                                                        })
                                                    />
                                                    {tag_label(&tag.name).to_owned()}
                                                </label>
                                            }
                                        }).collect::<Vec<_>>()}
                                    </div> }.into_any()
                                }
                            }
                        })}
                    </Suspense>
                </fieldset>
                <div class="actions">
                    <button type="submit" class="btn btn-primary">"Áp dụng"</button>
                    <A href=move || filter_url(&filters.get().title, &[], "", "follows", 1) attr:class="btn btn-ghost">"Xóa bộ lọc"</A>
                </div>
            </form>
        </details>
    }
}

#[component]
pub fn Genres() -> impl IntoView {
    let tags = LocalResource::new(|| get_json::<Vec<Tag>>("/api/tags"));
    view! {
        <main class="wrap catalog-page">
            <div class="page-intro"><div><h1>"Thể loại"</h1><p>"Chọn một chủ đề để tìm truyện hợp gu."</p></div></div>
            <Suspense fallback=move || skeleton()>
                {move || Suspend::new(async move {
                    match tags.await {
                        Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| tags.refetch()) /> }.into_any(),
                        Ok(list) if list.is_empty() => view! { <p class="empty">"Chưa có thể loại để hiển thị."</p> }.into_any(),
                        Ok(mut list) => {
                            list.sort_by(|a, b| tag_label(&a.name).cmp(tag_label(&b.name)));
                            [("genre", "Thể loại chính"), ("theme", "Chủ đề"), ("format", "Định dạng"), ("content", "Nội dung")]
                                .into_iter().map(|(group, title)| view! {
                                    <section class="surface genre-group">
                                        <h2>{title}</h2>
                                        <div class="tag-options">
                                            {list.iter().filter(|t| t.group == group).map(|t| {
                                                let label = tag_label(&t.name).to_owned();
                                                view! { <A href=filter_url("", std::slice::from_ref(&t.id), "", "follows", 1) attr:class="chapter-pill">{label}</A> }
                                            }).collect::<Vec<_>>()}
                                        </div>
                                    </section>
                                }).collect::<Vec<_>>().into_any()
                        }
                    }
                })}
            </Suspense>
        </main>
    }
}

#[component]
pub fn Ranking() -> impl IntoView {
    let query = use_query_map();
    let kind = Memo::new(move |_| match query.get().get("kind").as_deref() {
        Some("rating") => "rating", Some("new") => "new", _ => "follows",
    });
    view! {
        <main class="wrap catalog-page">
            <div class="page-intro"><div><h1>"Bảng xếp hạng"</h1><p>"Theo số lượt theo dõi, điểm đánh giá và cập nhật trên MangaDex."</p></div></div>
            <section class="surface">
                <nav class="rank-tabs" aria-label="Cách xếp hạng">
                    {[ ("follows", "Theo dõi"), ("rating", "Đánh giá"), ("new", "Mới cập nhật") ].into_iter().map(|(value, label)| view! {
                        <a href=format!("/bxh?kind={value}") aria-current=move || (kind.get() == value).then_some("page")>{label}</a>
                    }).collect::<Vec<_>>()}
                </nav>
                <RankList kind=kind limit=24 />
            </section>
        </main>
    }
}

#[component]
pub fn RankPanel() -> impl IntoView {
    let kind = RwSignal::new("follows");
    view! {
        <div class="rank-tabs" aria-label="Cách xếp hạng">
            <button type="button" aria-pressed=move || (kind.get() == "follows").to_string() on:click=move |_| kind.set("follows")>"Theo dõi"</button>
            <button type="button" aria-pressed=move || (kind.get() == "rating").to_string() on:click=move |_| kind.set("rating")>"Đánh giá"</button>
        </div>
        <RankList kind=Signal::from(kind) limit=5 />
    }
}

#[component]
fn RankList(#[prop(into)] kind: Signal<&'static str>, limit: usize) -> impl IntoView {
    let resource = LocalResource::new(move || {
        let kind = kind.get();
        async move {
            if kind == "new" {
                get_json::<Vec<LatestManga>>("/api/latest").await.map(|list| list.into_iter().map(|item| item.manga).collect())
            } else {
                get_json::<Vec<MangaSummary>>(&format!("/api/rank?kind={kind}")).await
            }
        }
    });
    view! {
        <Suspense fallback=move || view! { <div class="rank-loading" role="status" aria-label="Đang tải xếp hạng">{(0..limit.min(5)).map(|_| view! { <div class="skel skel-line"></div> }).collect::<Vec<_>>()}</div> }>
            {move || Suspend::new(async move {
                match resource.await {
                    Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| resource.refetch()) /> }.into_any(),
                    Ok(list) if list.is_empty() => view! { <p class="empty">"Chưa có truyện để xếp hạng."</p> }.into_any(),
                    Ok(list) => view! {
                        <ol class="rank-list">
                            {list.into_iter().take(limit).enumerate().map(|(i, m)| {
                                let cover = cover_url(&m, 256).map(|src| proxy(&src));
                                view! {
                                    <li>
                                        <A href=format!("/manga/{}", m.id) attr:class="rank-row">
                                            <b class:top-rank={i < 3}>{i + 1}</b>
                                            <span class="rank-cover">{cover.map(|src| view! { <img src=src alt="" loading="lazy" /> })}</span>
                                            <span class="rank-title">{m.title}
                                                <small>{m.follows.map(|n| format!("{n} theo dõi"))}</small>
                                            </span>
                                            {m.rating.filter(|r| *r > 0.0).map(|r| view! { <span class="rank-rating">{format!("★ {r:.1}")}</span> })}
                                        </A>
                                    </li>
                                }
                            }).collect::<Vec<_>>()}
                        </ol>
                    }.into_any(),
                }
            })}
        </Suspense>
    }
}
