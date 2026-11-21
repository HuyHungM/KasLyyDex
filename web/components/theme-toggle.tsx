"use client";

import { useEffect } from "react";
import { getTheme, saveTheme } from "@/lib/guest";
import { NavIcon } from "@/components/site-shell";

export default function ThemeToggle() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = getTheme();
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, []);

  return (
    <button
      className="icon-btn theme-btn"
      type="button"
      aria-label="Đổi giao diện sáng/tối"
      onClick={() => {
        const next = getTheme() === "dark" ? "light" : "dark";
        saveTheme(next);
        document.documentElement.dataset.theme = next;
      }}
    >
      <NavIcon name="moon" />
    </button>
  );
}
