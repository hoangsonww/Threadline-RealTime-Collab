"use client";

import { useEffect, useState } from "react";

/** Touch-first devices: a phone or tablet with no keyboard attached. */
const coarsePointerQuery = "(pointer: coarse)";

/**
 * True when the primary input is a touchscreen rather than a mouse.
 *
 * Used to decide whether keyboard affordances are worth showing. `(pointer: coarse)`
 * asks about the input device rather than the viewport, which is the question that
 * actually matters here — a narrow desktop window still has a keyboard, and a
 * tablet in landscape still does not.
 *
 * Starts `false` so the server and the first client render agree; a touch device
 * corrects it on mount rather than hydrating a mismatch.
 */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(coarsePointerQuery);
    setCoarse(query.matches);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
