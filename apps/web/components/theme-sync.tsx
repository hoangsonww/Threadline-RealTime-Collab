"use client";

import { useEffect } from "react";

/** Keeps the persisted appearance preference in place across client navigation. */
export function ThemeSync() {
  useEffect(() => {
    const saved = window.localStorage.getItem("threadline-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  }, []);

  return null;
}
