// Legacy compatibility alias. The only image fetcher is Axum; this route just
// forwards `/api/img?u=...` to its `/api/img` handler so old Leptos pages and
// cached Next HTML keep working. New page URLs use `/api/content/img`.
import { badRequest, contentOrigin, forwardGet, hasTraversal } from "@/lib/content-proxy";

export async function GET(request: Request) {
  const origin = contentOrigin();
  if (typeof origin !== "string") return origin;

  // The raw query value is checked before `new URL()` normalizes `..` away.
  const raw = new URL(request.url).searchParams.get("u")?.trim();
  if (!raw) return badRequest("Thiếu địa chỉ ảnh.");
  if (hasTraversal(raw)) return badRequest("Đường dẫn ảnh không hợp lệ.");

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(raw);
  } catch {
    return badRequest("Địa chỉ ảnh không hợp lệ.");
  }
  if (upstreamUrl.protocol !== "https:" || upstreamUrl.username || upstreamUrl.password) {
    return badRequest("Nguồn ảnh không được phép.");
  }

  const target = new URL(`${origin}/api/img?u=${encodeURIComponent(raw)}`);
  return forwardGet(request, target);
}
