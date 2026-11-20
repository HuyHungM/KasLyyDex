import type { Metadata } from "next";
import { Be_Vietnam_Pro, Oswald } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "KasLyyDex — Đọc manga online miễn phí",
    template: "%s | KasLyyDex",
  },
  description:
    "Đọc manga bản dịch tiếng Việt và tiếng Anh miễn phí, không quảng cáo. Dữ liệu từ MangaDex.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${beVietnam.variable} ${oswald.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Header />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          KasLyyDex — demo đọc truyện phi thương mại. Dữ liệu &amp; ảnh từ{" "}
          <a href="https://mangadex.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-paper">
            MangaDex
          </a>
          . Ủng hộ tác giả bằng cách mua truyện bản quyền.
        </footer>
      </body>
    </html>
  );
}
