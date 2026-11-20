use crate::api::*;
use crate::library_view::ShelfPreview;
use crate::views::{ContinueReading, LibraryUpdates, LoadError, MangaCard};
use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn Home() -> impl IntoView {
    let latest = LocalResource::new(|| get_json::<Vec<LatestManga>>("/api/latest"));
    let ranking = LocalResource::new(|| get_json::<Vec<MangaSummary>>("/api/rank?kind=follows"));
    let updates = expect_context::<LibraryUpdates>().0;
    Effect::new(move |_| {
        if let Some(Ok(feed)) = latest.get() {
            crate::library_view::merge_feed_updates(&feed, updates);
        }
    });
    view! {
        <main class="wrap home">
            <Suspense fallback=move || view! { <div class="feature skel" role="status" aria-label="Đang tải truyện nổi bật"></div> }>
                {move || Suspend::new(async move {
                    if let Ok(list) = ranking.await {
                        if let Some(manga) = list.into_iter().next() {
                            return view! { <Featured manga=manga /> }.into_any();
                        }
                    }
                    view! {
                        <section class="feature feature-fallback">
                            <div class="feature-copy">
                                <h1>"Khám phá truyện"</h1>
                                <p>"Tìm manga theo tên, thể loại hoặc xem các chương vừa cập nhật."</p>
                                <A href="/search" attr:class="btn btn-primary">"Tìm truyện →"</A>
                            </div>
                        </section>
                    }.into_any()
                })}
            </Suspense>
            <ContinueReading />
            <section class="popular-section" aria-labelledby="popular-title">
                <div class="panel-heading"><h2 id="popular-title">"Được theo dõi nhiều"</h2><A href="/bxh" attr:class="text-link">"Xem xếp hạng →"</A></div>
                <Suspense fallback=move || view! { <div class="popular-rail" role="status" aria-label="Đang tải truyện">{(0..6).map(|_| view! { <div class="skel skel-cover"></div> }).collect::<Vec<_>>()}</div> }>
                    {move || Suspend::new(async move {
                        match ranking.await {
                            Ok(list) if list.is_empty() => view! { <p class="empty">"Chưa có truyện để hiển thị."</p> }.into_any(),
                            Ok(list) => view! {
                                <div class="popular-rail">
                                    {list.into_iter().take(6).enumerate().map(|(index, manga)| view! { <MangaCard manga=manga rank=index + 1 /> }).collect::<Vec<_>>()}
                                </div>
                            }.into_any(),
                            Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| ranking.refetch()) /> }.into_any(),
                        }
                    })}
                </Suspense>
            </section>
            <div class="home-columns">
                <div class="home-main">
                    <section class="surface feed-panel" aria-label="Mới cập nhật">
                        <div class="panel-heading">
                            <h2><span class="live-mark" aria-hidden="true"></span>"Mới cập nhật"</h2>
                            <A href="/bxh?kind=new" attr:class="text-link">"Xem danh sách →"</A>
                        </div>
                        <Suspense fallback=move || view! { <FeedSkeleton /> }>
                            {move || Suspend::new(async move {
                                match latest.await {
                                    Ok(feed) if feed.is_empty() => view! { <p class="empty">"Chưa có chương mới. Bạn có thể tìm truyện theo thể loại."</p> }.into_any(),
                                    Ok(feed) => view! {
                                        <div class="chapter-feed">
                                            {feed.into_iter().map(|item| view! { <FeedRow item=item /> }).collect::<Vec<_>>()}
                                        </div>
                                    }.into_any(),
                                    Err(message) => view! { <LoadError message=message retry=Callback::new(move |_| latest.refetch()) /> }.into_any(),
                                }
                            })}
                        </Suspense>
                    </section>
                </div>
                <aside class="home-side">
                    <section class="surface">
                        <div class="panel-heading"><h2>"Bảng xếp hạng"</h2><A href="/bxh" attr:class="text-link">"Xem tất cả →"</A></div>
                        <crate::catalog::RankPanel />
                    </section>
                    <ShelfPreview />
                </aside>
            </div>
        </main>
    }
}

#[component]
fn Featured(manga: MangaSummary) -> impl IntoView {
    let cover = cover_url(&manga, 512).map(|url| proxy(&url));
    let href = format!("/manga/{}", manga.id);
    let status = status_text(&manga.status).to_owned();
    let description = manga.description.trim().to_owned();
    view! {
        <section class="feature" aria-labelledby="featured-title">
            {cover.map(|src| view! {
                <div class="feature-art" aria-hidden="true">
                    <img class="feature-bleed" src=src.clone() alt="" />
                    <img class="feature-poster" src=src alt="" fetchpriority="high" />
                </div>
            })}
            <div class="feature-copy">
                <p class="feature-label"><span aria-hidden="true"></span>"Truyện nổi bật"</p>
                <h1 id="featured-title">{manga.title}</h1>
                <p class="feature-meta">
                    {manga.rating.filter(|r| *r > 0.0).map(|rating| view! { <strong>{format!("★ {:.1}", rating)}</strong> })}
                    {manga.year.map(|year| view! { <span>{year}</span> })}
                    {(!status.is_empty()).then(|| view! { <span>{status}</span> })}
                </p>
                {(!description.is_empty()).then(|| view! { <p class="feature-description">{description}</p> })}
                <A href=href attr:class="btn btn-primary">"Xem truyện →"</A>
            </div>
        </section>
    }
}

#[component]
fn FeedSkeleton() -> impl IntoView {
    view! {
        <div role="status" aria-label="Đang tải chương mới">
            {(0..6).map(|_| view! {
                <div class="feed-row skel" aria-hidden="true"><div class="feed-cover"></div><div><div class="skel-line"></div><div class="skel-pill"></div></div></div>
            }).collect::<Vec<_>>()}
        </div>
    }
}

#[component]
fn FeedRow(item: LatestManga) -> impl IntoView {
    let LatestManga { manga, chapters } = item;
    let cover = cover_url(&manga, 256).map(|url| proxy(&url));
    let href = format!("/manga/{}", manga.id);
    let title = manga.title;
    let now = js_sys::Date::now();
    view! {
        <article class="feed-row">
            <A href=href.clone() attr:class="feed-cover" attr:aria-label=format!("Xem truyện {title}")>
                {cover.map(|src| view! { <img src=src alt="" loading="lazy" decoding="async" /> })}
            </A>
            <div class="feed-details">
                <h3><A href=href>{title}</A></h3>
                <div class="chapter-pills">
                    {chapters.into_iter().enumerate().map(|(index, chapter)| {
                        let href = format!("/read/{}?manga={}&lang={}", chapter.id, manga.id, chapter.lang);
                        let language = if chapter.lang == "vi" { "VI" } else { "EN" };
                        let language_name = if chapter.lang == "vi" { "Tiếng Việt" } else { "Tiếng Anh" };
                        let label = chapter_name(chapter.chapter.as_deref());
                        let date = rel_date(&chapter.publish_at, now);
                        view! {
                            <A href=href attr:class=if index == 0 { "chapter-pill fresh" } else { "chapter-pill" }>
                                {label}<abbr title=language_name>{language}</abbr>
                                {(index == 0 && !date.is_empty()).then(|| view! { <span class="feed-date">{date}</span> })}
                            </A>
                        }
                    }).collect::<Vec<_>>()}
                </div>
            </div>
        </article>
    }
}
