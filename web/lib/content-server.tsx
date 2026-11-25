import "server-only";
import { connection } from "next/server";
import { createContentClient, type ContentClient } from "@/lib/contracts";

/// Server Components call Axum directly through the same typed client; the
/// browser uses the same-origin proxy. No route ever calls MangaDex itself.
export async function serverContent(): Promise<ContentClient> {
  await connection();
  const origin = process.env.RUST_CONTENT_API_ORIGIN?.trim();
  if (!origin) throw new Error("CONTENT_NOT_CONFIGURED");
  return createContentClient(origin);
}

export function contentUnavailable(message: string) {
  return (
    <div className="empty" role="alert">
      <h2>Chưa có dữ liệu truyện</h2>
      <p>{message}</p>
      <p>Không thể kết nối tới dịch vụ nội dung. Vui lòng thử lại sau.</p>
    </div>
  );
}
