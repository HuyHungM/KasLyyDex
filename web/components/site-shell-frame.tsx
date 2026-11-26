import Link from "next/link";
import { Suspense } from "react";
import SiteHeader from "@/components/site-header";
import { NavIcon } from "@/components/nav-icon";

const LINKS = [
  { href: "/", label: "Trang chủ", icon: "home", exact: true },
  { href: "/search", label: "Khám phá", icon: "search", mobileHidden: true },
  { href: "/bxh", label: "Xếp hạng", icon: "rank" },
  { href: "/tu-truyen", label: "Tủ truyện", icon: "bookmark" },
  { href: "/thong-bao", label: "Thông báo", icon: "bell" },
  { href: "/tai-khoan", label: "Tài khoản", icon: "user" },
];

function NavLinks({ pathname = "", mobile = false }: { pathname?: string; mobile?: boolean }) {
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

export default function SiteShellFrame({ children, pathname = "" }: { children: React.ReactNode; pathname?: string }) {
  const reading = pathname.startsWith("/read/");
  return (
    <div className={`site-shell${reading ? " reading" : ""}`}>
      <div className="route-progress is-idle" aria-hidden="true" />
      {!reading ? (
        <aside className="site-rail">
          <Link href="/" className="logo" aria-label="KasLyyDex — trang chủ">
            <span className="logo-mark"><NavIcon name="book" /></span>
            <span>KasLyy<b>Dex</b></span>
          </Link>
          <nav className="nav-links" aria-label="Điều hướng chính"><NavLinks pathname={pathname} /></nav>
          <div className="rail-source">
            <span>NGUỒN TRUYỆN</span>
            <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex ↗</a>
          </div>
        </aside>
      ) : null}
      <div className="site-content">
        {!reading ? (
          <Suspense fallback={<div className="site-header shell-header-skeleton" aria-hidden="true" />}>
            <SiteHeader />
          </Suspense>
        ) : null}
        <div className="flex-1" id="noi-dung">{children}</div>
        {!reading ? (
          <footer className="site-footer">
            <span className="footer-brand">KasLyyDex</span>
            <p>Dữ liệu và ảnh từ <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer">MangaDex</a>. Ủng hộ tác giả bằng cách mua truyện bản quyền.</p>
          </footer>
        ) : null}
      </div>
      {!reading ? (
        <nav className="bottom-tabs" aria-label="Điều hướng trên điện thoại"><NavLinks pathname={pathname} mobile /></nav>
      ) : null}
    </div>
  );
}
