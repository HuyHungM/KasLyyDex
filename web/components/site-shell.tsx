"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SiteHeader from "@/components/site-header";
import RouteProgress from "@/components/route-progress";

const LINKS = [
  { href: "/", label: "Trang chủ", icon: "home", exact: true },
  { href: "/search", label: "Khám phá", icon: "search", mobileHidden: true },
  { href: "/bxh", label: "Xếp hạng", icon: "rank" },
  { href: "/tu-truyen", label: "Tủ truyện", icon: "bookmark" },
  { href: "/thong-bao", label: "Thông báo", icon: "bell" },
  { href: "/tai-khoan", label: "Tài khoản", icon: "user" },
];

export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
    rank: "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 5 M17 6h3a3 3 0 0 1-3 5 M12 14v6m-4 0h8",
    bookmark: "M6 4h12v16l-6-4-6 4z",
    search: "M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0z m-2 6 5 5",
    sun: "M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19",
    moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z",
    book: "M12 5v15M3 4h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v14h-4a6 6 0 0 0-5 2 6 6 0 0 0-5-2H3z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  };
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}

function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {LINKS.filter((link) => !(mobile && link.mobileHidden)).map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            <NavIcon name={link.icon} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reading = pathname.startsWith("/read/");
  return (
    <div className={`site-shell${reading ? " reading" : ""}`}>
      {reading ? <RouteProgress floating /> : null}
      {!reading && (
        <aside className="site-rail">
          <Link href="/" className="logo" aria-label="KasLyyDex — trang chủ">
            <span className="logo-mark"><NavIcon name="book" /></span>
            <span>KasLyy<b>Dex</b></span>
          </Link>
          <nav className="nav-links" aria-label="Điều hướng chính"><NavLinks /></nav>
          <div className="rail-source">
            <span>NGUỒN TRUYỆN</span>
            <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex ↗</a>
          </div>
        </aside>
      )}
      <div className="site-content">
        {!reading && <SiteHeader />}
        <div className="flex-1" id="noi-dung">{children}</div>
        {!reading && (
          <footer className="site-footer">
            <span className="footer-brand">KasLyyDex</span>
            <p>Dữ liệu và ảnh từ <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex</a>. Ủng hộ tác giả bằng cách mua truyện bản quyền.</p>
          </footer>
        )}
      </div>
      {!reading && (
        <nav className="bottom-tabs" aria-label="Điều hướng trên điện thoại"><NavLinks mobile /></nav>
      )}
    </div>
  );
}
