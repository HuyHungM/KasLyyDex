import type { LatestMangaDto } from "@/lib/contracts";

const DAY = 86_400_000;

function latestPublish(item: LatestMangaDto): number {
  return item.chapters.reduce((latest, chapter) => {
    const time = Date.parse(chapter.publish_at);
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, 0);
}

export function dailyFeatured(items: LatestMangaDto[], now = Date.now(), limit = 10): LatestMangaDto[] {
  const fresh = items.filter((item) => item.chapters.some((chapter) => {
    const time = Date.parse(chapter.publish_at);
    return Number.isFinite(time) && time >= now - DAY;
  }));
  return [...fresh]
    .sort((a, b) => (b.follows ?? 0) - (a.follows ?? 0) || latestPublish(b) - latestPublish(a))
    .slice(0, limit);
}