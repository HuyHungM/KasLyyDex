"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-2xl font-semibold uppercase text-vermillion">Có lỗi xảy ra</h1>
      <p className="mt-3 text-sm text-muted">{error.message || "Không tải được dữ liệu từ MangaDex."}</p>
      <button
        onClick={reset}
        className="mt-6 rounded-full bg-vermillion px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-vermillion-dark"
      >
        Thử lại
      </button>
    </main>
  );
}