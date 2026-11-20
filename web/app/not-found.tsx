import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-semibold uppercase text-vermillion">404 — Không tìm thấy</h1>
      <p className="mt-3 text-sm text-muted">Truyện hoặc chapter này không tồn tại (hoặc đã bị xóa khỏi MangaDex).</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-vermillion px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-vermillion-dark"
      >
        Về trang chủ
      </Link>
    </main>
  );
}