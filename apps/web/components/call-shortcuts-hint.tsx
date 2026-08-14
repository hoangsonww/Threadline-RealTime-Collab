"use client";

import { KeyboardIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { shortcutCatalog } from "../lib/call-shortcuts";

/**
 * The visible affordance for the call keyboard shortcuts.
 *
 * Tooltips and `aria-keyshortcuts` already carry the keys, but a tooltip only
 * exists for someone who happens to hover and the ARIA attribute only for someone
 * using a screen reader — which leaves a sighted person who reaches for the mouse
 * every time with no way to find out the shortcuts are there at all.
 *
 * The list is rendered from `shortcutCatalog`, the same table the matcher binds
 * from, so a new shortcut appears here without anyone remembering to add it.
 */
export function CallShortcutsHint() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="call-shortcuts" ref={containerRef}>
      {open && (
        <div className="call-shortcuts-popover" role="dialog" aria-label="Keyboard shortcuts">
          <strong>Keyboard shortcuts</strong>
          <ul>
            {shortcutCatalog.map((entry) => (
              <li key={entry.action}>
                <kbd>{entry.key}</kbd>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
          <p>Paused while you&apos;re typing, so they never fire from a message.</p>
        </div>
      )}
      <button
        type="button"
        className={`control ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
      >
        <KeyboardIcon size={18} />
      </button>
    </div>
  );
}
