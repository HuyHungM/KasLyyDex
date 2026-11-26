"use client";

import { usePathname } from "next/navigation";
import SiteShellFrame from "@/components/site-shell-frame";

export { NavIcon } from "@/components/nav-icon";

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <SiteShellFrame pathname={pathname}>{children}</SiteShellFrame>;
}
