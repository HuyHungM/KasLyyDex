import type { Metadata } from "next";
import { Suspense } from "react";
import { Be_Vietnam_Pro, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import AuthCallback from "@/components/auth-callback";
import SiteShell from "@/components/site-shell";
import SiteShellFrame from "@/components/site-shell-frame";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700", "800"],
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
    <html lang="vi" className={`${beVietnam.variable} ${bricolage.variable}`}>
      <body>
        <AuthCallback />
        <Suspense fallback={<SiteShellFrame>{children}</SiteShellFrame>}>
          <SiteShell>{children}</SiteShell>
        </Suspense>
      </body>
    </html>
  );
}
