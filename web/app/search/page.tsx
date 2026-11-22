import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { searchQuery } from "@/lib/contracts";
import { statusText } from "@/lib/format";
import { GridSkeleton, MangaGrid } from "@/components/manga-card";
import GenreGroups from "@/components/search/GenreGroups";
import GenreGroupsSkeleton from "@/components/search/GenreGroupsSkeleton";
import Select from "@/components/ui/Select";

type Query = {
  q?: string;
  tags?: string | string[];
  status?: string;
  sort?: string;
  page?: string;
  source?: string;
  lang?: string;
  year?: string;
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
const SOURCES = [["all", "Tất cả"], ["mangadex", "MangaDex"], ["comick", "Comick"]] as const;
const LANGS = [["all", "Tất cả"], ["vi", "Tiếng Việt"], ["en", "Tiếng Anh"]] as const;
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getUTCFullYear() + 1;
const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, index) => String(MAX_YEAR - index));

function parseQuery(query: Query) {
  const raw = Array.isArray(query.tags) ? query.tags : query.tags ? [query.tags] : [];
  const tags = raw.flatMap((value) => value.split(",")).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  const page = Math.min(416, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const rawYear = typeof query.year === "string" ? query.year.trim() : "";
  const year = /^\d{4}$/.test(rawYear) && Number(rawYear) >= MIN_YEAR && Number(rawYear) <= MAX_YEAR
    ? Number(rawYear)
    : undefined;
  return {
    q: (query.q ?? "").trim(),
    tags,
    status: STATUSES.includes(query.status as (typeof STATUSES)[number]) ? query.status! : "",
    sort: SORTS.some(([value]) => value === query.sort) ? query.sort! : "follows",
    page,
    source: SOURCES.some(([value]) => value === query.source) ? query.source! : "all",
    lang: LANGS.some(([value]) => value === query.lang) ? query.lang! : "all",
    year,
  };
}

function searchHref(current: ReturnType<typeof parseQuery>, page = current.page) {
  return `/search${searchQuery({ ...current, page })}`;
}

async function Filters({ current }: { current: ReturnType<typeof parseQuery> }) {
  const count = current.tags.length
    + Number(Boolean(current.status))
    + Number(current.sort !== "follows")
    + Number(current.source !== "all")
    + Number(current.lang !== "all")
    + Number(current.year !== undefined);

  return (
    <details className="surface search-filters">
      <summary>Bộ lọc{count > 0 ? ` (${count})` : ""}</summary>
      <form action="/search" method="get">
        <input type="hidden" name="q" value={current.q} />
        <div className="filter-fields">
          <label>Nguồn
            <Select
              name="source"
              ariaLabel="Nguồn"
              defaultValue={current.source}
              options={SOURCES.map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>Ngôn ngữ
            <Select
              name="lang"
              ariaLabel="Ngôn ngữ"
              defaultValue={current.lang}
              options={LANGS.map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>Năm
            <Select
              name="year"
              ariaLabel="Năm"
              defaultValue={current.year === undefined ? "" : String(current.year)}
              options={[{ value: "", label: "Tất cả" }, ...YEARS.map((value) => ({ value, label: value }))]}
            />
          </label>
          <label>Trạng thái
            <Select
              name="status"
              ariaLabel="Trạng thái"
              defaultValue={current.status}
              options={[
                { value: "", label: "Tất cả" },
                ...STATUSES.map((status) => ({ value: status, label: statusText(status) })),
              ]}
            />
          </label>
          <label>Sắp xếp
            <Select
              name="sort"
              ariaLabel="Sắp xếp"
              defaultValue={current.sort}
              options={SORTS.map(([value, label]) => ({ value, label }))}
            />
          </label>
        </div>
        <fieldset className="filter-tags">
          <legend>Thể loại ({current.tags.length}/8)</legend>
          <Suspense fallback={<GenreGroupsSkeleton />}>
            <GenreGroups selected={current.tags} />
          </Suspense>
        </fieldset>
        <div className="actions">
          <button type="submit" className="btn btn-primary">Áp dụng</button>
          <Link href={`/search${searchQuery({ q: current.q })}`} className="btn">Xóa bộ lọc</Link>
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
      {results.partial ? (
        <p className="result-info partial-warning" role="status">Lưu ý: kết quả có thể chưa đầy đủ do giới hạn từ nguồn dữ liệu.</p>
      ) : null}
      <p className="result-info">{results.total > 0 ? label : "Không tìm thấy truyện nào. Thử tên khác hoặc bỏ bớt bộ lọc."}</p>
      <MangaGrid list={results.results} />
      {pages > 1 && (
        <nav className="pagination" aria-label="Trang kết quả">
          {current.page > 1 ? (
            <Link href={searchHref(current, current.page - 1)} className="btn">← Trước</Link>
          ) : null}
          <span className="page-info">Trang {current.page}/{pages}</span>
          {current.page < pages ? (
            <Link href={searchHref(current, current.page + 1)} className="btn">Sau →</Link>
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
      <Suspense fallback={
        <div className="surface search-filters" role="status" aria-label="Đang tải bộ lọc">
          <div className="skel-line w60" aria-hidden="true" />
          <fieldset className="filter-tags">
            <legend>Thể loại</legend>
            <GenreGroupsSkeleton />
          </fieldset>
        </div>
      }>
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
    <Suspense fallback={
      <main className="wrap catalog-page">
        <div className="page-intro"><h1>Khám phá truyện</h1></div>
        <GridSkeleton />
      </main>
    }>
      <SearchContent {...props} />
    </Suspense>
  );
}
