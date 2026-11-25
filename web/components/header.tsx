"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";

function SearchForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");

  return (
    <form
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm truyện… (vd: One Piece)"
        aria-label="Tìm truyện"
        className="w-full rounded-full border border-line bg-panel px-4 py-2 pr-10 text-sm text-paper placeholder:text-muted outline-none transition focus:border-vermillion"
      />
      <button
        type="submit"
        aria-label="Tìm kiếm"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted transition hover:text-vermillion"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
    </form>
  );
}

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-display text-2xl font-semibold uppercase tracking-wide text-paper">
          KasLyy<span className="text-vermillion">Dex</span>
        </Link>
        <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1">
          <Suspense fallback={<div className="h-9 w-full max-w-md rounded-full bg-panel" />}>
            <SearchForm />
          </Suspense>
        </div>
        <nav className="order-2 ml-auto flex items-center gap-4 text-sm text-muted sm:order-3">
          <Link href="/" className="transition hover:text-paper">
            Trang chủ
          </Link>
          <Link href="/tai-khoan" className="transition hover:text-paper">
            Tài khoản
          </Link>
          <a
            href="https://mangadex.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden transition hover:text-paper sm:block"
          >
            MangaDex ↗
          </a>
        </nav>
      </div>
    </header>
  );
}
