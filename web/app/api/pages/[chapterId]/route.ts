import { getChapterPages } from "@/lib/mangadex";

// Same-origin proxy so the browser never calls api.mangadex.org directly
// (it can be sinkholed by local DNS filters, and at-home URLs expire quickly).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chapterId: string }> },
) {
  const { chapterId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(chapterId)) {
    return Response.json({ error: "chapterId không hợp lệ." }, { status: 400 });
  }
  try {
    const pages = await getChapterPages(chapterId);
    return Response.json({ pages });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}