"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const getPreferredTheme = (): Theme => {
  const saved = window.localStorage.getItem("threadline-theme");
  if (saved === "light" || saved === "dark") return saved;
  // The document is rendered in the Threadline dark theme on the server.
  // Keeping that default after hydration prevents a flash and avoids layout
  // movement before a visitor has made an explicit preference.
  return "dark";
};

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const next = getPreferredTheme();
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("threadline-theme", next);
  };

  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? "theme-toggle-compact" : ""}`}
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <SunIcon size={16} weight="bold" /> : <MoonIcon size={16} weight="bold" />}
    </button>
  );
}
