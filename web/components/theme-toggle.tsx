"use client";

import { useEffect, useState } from "react";
import { getTheme, saveTheme, type Theme } from "@/lib/guest";
import { NavIcon } from "@/components/nav-icon";

const ORDER: readonly Theme[] = ["light", "dark", "black"];
const LABELS: Record<Theme, string> = { light: "sáng", dark: "tối", black: "đen" };

export default function ThemeToggle() {
  const [current, setCurrent] = useState<Theme>("light");

  useEffect(() => {
    const apply = () => {
      const theme = getTheme();
      document.documentElement.dataset.theme = theme;
      setCurrent(theme);
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, []);

  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <button
      className="icon-btn theme-btn"
      type="button"
      aria-label={`Đổi giao diện: đang ${LABELS[current]}, sang ${LABELS[next]}`}
      onClick={() => {
        saveTheme(next);
        document.documentElement.dataset.theme = next;
        setCurrent(next);
      }}
    >
      <NavIcon name="moon" />
    </button>
  );
}
