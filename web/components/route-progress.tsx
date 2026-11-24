"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function RouteProgress() {
  const [pending, setPending] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("#")) return;
      const target = new URL(href, window.location.href);
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
      setPending(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setPending(false), 250);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return <div className={`route-progress${pending ? " is-pending" : ""}`} aria-hidden="true" />;
}
