"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Phase = "idle" | "loading" | "done";

export default function RouteProgress() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [target, setTarget] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("#")) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const key = destination.pathname + destination.search;
      if (key === window.location.pathname + window.location.search) return;
      setTarget(key);
      setPhase("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!target) return;
    const deadline = performance.now() + 5000;
    let frame = 0;
    let timer = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setPhase("done");
      timer = window.setTimeout(() => { setPhase("idle"); setTarget(null); }, 320);
    };
    const check = () => {
      const current = window.location.pathname + window.location.search;
      if (current === target || performance.now() > deadline) { finish(); return; }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [target]);

  // Sit right under whichever top bar the current route uses: the site header
  // or the reader toolbar. One instance survives both sides of the transition.
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    const update = () => {
      const bar = document.querySelector(".reader-bar") ?? document.querySelector(".site-header");
      document.documentElement.style.setProperty("--route-progress-top", `${Math.round(bar?.getBoundingClientRect().height ?? 0)}px`);
      if (bar) {
        observer?.disconnect();
        observer = new ResizeObserver(update);
        observer.observe(bar);
      }
    };
    update();
    return () => observer?.disconnect();
  }, [pathname]);

  return <div className={`route-progress is-${phase}`} aria-hidden="true" />;
}
