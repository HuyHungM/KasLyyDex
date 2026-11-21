import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import type { TagDto } from "@/lib/contracts";
import { filterUrl, tagLabel } from "@/lib/format";

const GROUPS = [
  ["genre", "Thể loại chính"],
  ["theme", "Chủ đề"],
  ["format", "Định dạng"],
  ["content", "Nội dung"],
] as const;

async function GenreGroups() {
  let tags: TagDto[] = [];
  try {
    tags = await (await serverContent()).tags();
  } catch {
    return <div className="surface empty" role="alert">Chưa tải được thể loại. Vui lòng thử lại sau.</div>;
  }
  tags.sort((a, b) => tagLabel(a.name).localeCompare(tagLabel(b.name)));
  return (
    <>
      {GROUPS.map(([group, title]) => {
        const groupTags = tags.filter((tag) => tag.group === group);
        if (groupTags.length === 0) return null;
        return (
          <section className="surface genre-group" key={group}>
            <h2>{title}</h2>
            <div className="tag-options">
              {groupTags.map((tag) => (
                <Link key={tag.id} href={filterUrl("", [tag.id], "", "follows", 1)} className="chapter-pill">
                  {tagLabel(tag.name)}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

export default function GenresPage() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Thể loại</h1><p>Chọn một chủ đề để tìm truyện hợp gu.</p></div>
      </div>
      <Suspense fallback={<div className="surface skel" role="status" aria-label="Đang tải thể loại" />}>
        <GenreGroups />
      </Suspense>
    </main>
  );
}
