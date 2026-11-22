import { serverContent } from "@/lib/content-server";
import type { TagDto } from "@/lib/contracts";
import { tagLabel } from "@/lib/format";

const GROUPS = [
  ["genre", "Thể loại chính"],
  ["theme", "Chủ đề"],
  ["format", "Định dạng"],
  ["content", "Nội dung"],
] as const;

export default async function GenreGroups({ selected }: { selected: string[] }) {
  let tags: TagDto[] = [];
  try {
    tags = await (await serverContent()).tags();
  } catch {
    return <p className="empty" role="alert">Chưa tải được thể loại. Vui lòng thử lại sau.</p>;
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
                <label className="filter-tag chapter-pill" key={tag.id}>
                  <input type="checkbox" name="tags" value={tag.id} defaultChecked={selected.includes(tag.id)} />
                  {tagLabel(tag.name)}
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
