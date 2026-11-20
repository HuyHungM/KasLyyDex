// Pure types & helpers — safe to import from both Server and Client Components.

export type MangaSummary = {
  id: string;
  title: string;
  coverFile: string | null;
  status: string;
  year: number | null;
  description: string;
  tags: string[];
  author: string;
  artist: string;
};

export type Chapter = {
  id: string;
  chapter: string | null;
  volume: string | null;
  title: string;
  lang: string;
  pages: number;
  externalUrl: string | null;
  publishAt: string;
  group: string;
};

export function coverUrl(m: Pick<MangaSummary, "id" | "coverFile">, size = 256): string | null {
  return m.coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${m.coverFile}.${size}.jpg` : null;
}

// All MangaDex images go through our own proxy: local DNS filters may
// sinkhole mangadex hosts, and the Next image optimizer refuses private IPs.
export function imgProxy(url: string): string {
  return `/api/img?u=${encodeURIComponent(url)}`;
}

export function chapterLabel(c: Chapter): string {
  return c.chapter ? `Ch. ${c.chapter}` : "Oneshot";
}

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