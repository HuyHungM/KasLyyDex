import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import type { TagDto } from "@/lib/contracts";
import { filterUrl, statusText, tagLabel } from "@/lib/format";
import { GridSkeleton, MangaGrid } from "@/components/manga-card";

type Query = {
  q?: string;
  tags?: string | string[];
  status?: string;
  sort?: string;
  page?: string;
};

type Props = { searchParams: Promise<Query> };

const SORTS = [
  ["follows", "Lượt theo dõi"],
  ["rating", "Điểm đánh giá"],
  ["new", "Cập nhật gần đây"],
  ["year", "Năm phát hành"],
  ["title", "Tên A–Z"],
] as const;

const STATUSES = ["ongoing", "completed", "hiatus", "cancelled"] as const;

function parseQuery(query: Query) {
  const raw = Array.isArray(query.tags) ? query.tags : query.tags ? [query.tags] : [];
  const tags = raw.flatMap((value) => value.split(",")).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  const page = Math.min(416, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  return {
    q: (query.q ?? "").trim(),
    tags,
    status: STATUSES.includes(query.status as (typeof STATUSES)[number]) ? query.status! : "",
    sort: SORTS.some(([value]) => value === query.sort) ? query.sort! : "follows",
    page,
  };
}

async function Filters({ current }: { current: ReturnType<typeof parseQuery> }) {
  let tags: TagDto[] = [];
  try {
    tags = (await (await serverContent()).tags()).slice();
  } catch {
    tags = [];
  }
  tags.sort((a, b) => tagLabel(a.name).localeCompare(tagLabel(b.name)));
  const count = current.tags.length + Number(Boolean(current.status)) + Number(current.sort !== "follows");

  return (
    <details className="surface search-filters">
      <summary>Bộ lọc{count > 0 ? ` (${count})` : ""}</summary>
      <form action="/search" method="get">
        <input type="hidden" name="q" value={current.q} />
        <div className="filter-fields">
          <label>Trạng thái
            <select name="status" defaultValue={current.status}>
              <option value="">Tất cả</option>
              {STATUSES.map((status) => <option key={status} value={status}>{statusText(status)}</option>)}
            </select>
          </label>
          <label>Sắp xếp
            <select name="sort" defaultValue={current.sort}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="filter-tags">
          <legend>Thể loại ({current.tags.length}/8)</legend>
          <div className="tag-options">
            {tags.map((tag) => (
              <label className="filter-tag" key={tag.id}>
                <input type="checkbox" name="tags" value={tag.id} defaultChecked={current.tags.includes(tag.id)} />
                {tagLabel(tag.name)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button type="submit" className="btn btn-primary">Áp dụng</button>
          <Link href={filterUrl(current.q, [], "", "follows", 1)} className="btn">Xóa bộ lọc</Link>
        </div>
      </form>
    </details>
  );
}

async function Results({ searchParams }: Props) {
  const current = parseQuery(await searchParams);
  let results: Awaited<ReturnType<Awaited<ReturnType<typeof serverContent>>["search"]>> = { results: [], total: 0 };
  let failed = false;
  try {
    results = await (await serverContent()).search(current);
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="surface empty" role="alert">
        <h2>Không tải được danh sách</h2>
        <p>Dịch vụ nội dung chưa sẵn sàng. Vui lòng thử lại sau.</p>
        <Link href="/search" className="btn">Thử lại</Link>
      </div>
    );
  }

  const pages = Math.ceil(results.total / 24);
  const label = current.q
    ? `${results.total} kết quả cho “${current.q}”`
    : `${results.total} truyện`;

  return (
    <>
      <p className="result-info">{results.total > 0 ? label : "Không tìm thấy truyện nào. Thử tên khác hoặc bỏ bớt bộ lọc."}</p>
      <MangaGrid list={results.results} />
      {pages > 1 && (
        <nav className="pagination" aria-label="Trang kết quả">
          {current.page > 1 ? (
            <Link href={filterUrl(current.q, current.tags, current.status, current.sort, current.page - 1)} className="btn">← Trước</Link>
          ) : null}
          <span className="page-info">Trang {current.page}/{pages}</span>
          {current.page < pages ? (
            <Link href={filterUrl(current.q, current.tags, current.status, current.sort, current.page + 1)} className="btn">Sau →</Link>
          ) : null}
        </nav>
      )}
    </>
  );
}

async function SearchContent({ searchParams }: Props) {
  const current = parseQuery(await searchParams);
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Khám phá truyện</h1><p>Lọc theo thể loại, trạng thái hoặc cách sắp xếp.</p></div>
      </div>
      <Suspense fallback={<div className="surface skel" role="status" aria-label="Đang tải bộ lọc" />}>
        <Filters current={current} />
      </Suspense>
      <Suspense fallback={<GridSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

export default function SearchPage(props: Props) {
  return (
    <Suspense fallback={<main className="wrap catalog-page" role="status" aria-label="Đang tải kết quả" />}>
      <SearchContent {...props} />
    </Suspense>
  );
}
