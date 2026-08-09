"use client";

import { CheckIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem("threadline-theme") === "light" ? "light" : "dark";
}

export function ThemePreference() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => setTheme(readTheme()), []);

  const selectTheme = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("threadline-theme", next);
  };

  return (
    <div className="theme-preference" role="group" aria-label="Color theme">
      <button
        type="button"
        className={theme === "dark" ? "active" : ""}
        onClick={() => selectTheme("dark")}
        aria-pressed={theme === "dark"}
      >
        <MoonIcon size={16} weight="fill" />
        Dark
        {theme === "dark" && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className={theme === "light" ? "active" : ""}
        onClick={() => selectTheme("light")}
        aria-pressed={theme === "light"}
      >
        <SunIcon size={16} weight="fill" />
        Light
        {theme === "light" && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      </button>
    </div>
  );
}
