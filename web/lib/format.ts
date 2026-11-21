// Pure presentation helpers shared by Server and Client Components.

export function statusText(status: string): string {
  return (
    {
      ongoing: "Đang tiến hành",
      completed: "Hoàn thành",
      hiatus: "Tạm ngưng",
      cancelled: "Đã hủy",
    }[status] || status
  );
}

export function chapterName(number?: string | null): string {
  return number ? `Chương ${number}` : "Truyện ngắn";
}

export function chapterLabel(chapter?: string | null): string {
  return chapter ? `Ch. ${chapter}` : "Oneshot";
}

export function tagLabel(name: string): string {
  // MangaDex tags arrive as "Title Case"; trim the descriptor suffix in Vietnamese UI.
  return name.replace(/\s*\((?:Manga|Manhwa|Manhua)\)\s*$/i, "").trim() || name;
}

export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function relDate(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} ngày trước` : fmtDate(iso);
}

/// Search URL construction mirrors the Leptos `filter_url` wire format:
/// tags are a comma-separated single query value.
export function filterUrl(
  q: string,
  tags: string[],
  status: string,
  sort: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (tags.length > 0) params.set("tags", tags.join(","));
  if (status) params.set("status", status);
  if (sort && sort !== "follows") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/search${query ? `?${query}` : ""}`;
}
