"use client";

import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import { NavIcon } from "@/components/site-shell";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="mobile-brand">
          <Link href="/" className="logo" aria-label="KasLyyDex — trang chủ">
            <span className="logo-mark"><NavIcon name="book" /></span>
            <span>KasLyy<b>Dex</b></span>
          </Link>
        </div>
        <form className="search-form" role="search" action="/search" method="get">
          <button type="submit" className="search-btn" aria-label="Tìm kiếm">
            <NavIcon name="search" />
          </button>
          <input
            className="search-input"
            type="search"
            name="q"
            maxLength={200}
            placeholder="Nhập tên truyện…"
            aria-label="Tìm truyện"
          />
        </form>
        <ThemeToggle />
      </div>
    </header>
  );
}
