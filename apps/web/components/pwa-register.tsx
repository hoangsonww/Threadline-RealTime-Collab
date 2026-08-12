"use client";

import { useEffect } from "react";

/** Registers the no-op, installability-only service worker in production only. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a progressive enhancement — nothing in the app
      // depends on the service worker being active.
    });
  }, []);

  return null;
}
