"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Phase = "idle" | "loading" | "done";

export default function RouteProgress() {
  const [phase, setPhase] = useState<Phase>("idle");
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
      setPhase("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    // The new route is committed: finish the bar, then retire it.
    setPhase("done");
    const timer = window.setTimeout(() => setPhase("idle"), 320);
    return () => window.clearTimeout(timer);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className={`route-progress is-${phase}`} aria-hidden="true" />;
}
