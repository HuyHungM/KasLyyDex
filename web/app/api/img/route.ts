// Legacy compatibility alias. The only image fetcher is Axum; this route just
// forwards `/api/img?u=...` to its `/api/img` handler so old Leptos pages and
// cached Next HTML keep working. New page URLs use `/api/content/img`.
import { badRequest, contentOrigin, forwardGet, invalidImageSource } from "@/lib/content-proxy";

export async function GET(request: Request) {
  const origin = contentOrigin();
  if (typeof origin !== "string") return origin;

  // The raw query value is checked before `new URL()` normalizes `..` away.
  const raw = new URL(request.url).searchParams.get("u")?.trim();
  if (invalidImageSource(raw)) return badRequest("Địa chỉ ảnh không hợp lệ.");

  const target = new URL(`${origin}/api/img?u=${encodeURIComponent(raw as string)}`);
  return forwardGet(request, target);
}
