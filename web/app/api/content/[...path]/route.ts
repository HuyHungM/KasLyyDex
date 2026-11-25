import { badRequest, contentOrigin, forwardGet, invalidImageSource, unsafeSegment } from "@/lib/content-proxy";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  const origin = contentOrigin();
  if (typeof origin !== "string") return origin;

  const { path } = await context.params;
  if (path.length === 0 || path.some(unsafeSegment)) {
    return badRequest("Đường dẫn nội dung không hợp lệ.");
  }
  // The canonical image endpoint gets the same raw source guard as the legacy
  // alias; every other content endpoint keeps its existing path-only policy.
  if (path[0] === "img" && path.length === 1) {
    const raw = new URL(request.url).searchParams.get("u")?.trim();
    if (invalidImageSource(raw)) return badRequest("Địa chỉ ảnh không hợp lệ.");
  }
  const target = new URL(`${origin}/api/content/${path.map(encodeURIComponent).join("/")}`);
  target.search = new URL(request.url).search;
  return forwardGet(request, target);
}
