import { describe, expect, it } from "vitest";
import { callShortcutFor, shortcutKey } from "./call-shortcuts";

const element = (tagName: string, contentEditable = false) =>
  ({ tagName, isContentEditable: contentEditable }) as unknown as EventTarget;

describe("call keyboard shortcuts", () => {
  it("maps the bound keys regardless of case", () => {
    expect(callShortcutFor({ key: "m" })).toBe("toggleMic");
    expect(callShortcutFor({ key: "M" })).toBe("toggleMic");
    expect(callShortcutFor({ key: "v" })).toBe("toggleCamera");
    expect(callShortcutFor({ key: "S" })).toBe("toggleScreenShare");
  });

  it("ignores keys that are not bound", () => {
    for (const key of ["a", "z", "1", "?"]) expect(callShortcutFor({ key })).toBeUndefined();
  });

  it("ignores non-character keys so navigation still works", () => {
    for (const key of ["Enter", "Tab", "Escape", "ArrowLeft", "Shift"])
      expect(callShortcutFor({ key })).toBeUndefined();
  });

  it("leaves modified keys to the browser and the OS", () => {
    // Claiming ⌘S or Ctrl+V would break saving and pasting for a feature that has
    // no business outranking either.
    expect(callShortcutFor({ key: "s", metaKey: true })).toBeUndefined();
    expect(callShortcutFor({ key: "v", ctrlKey: true })).toBeUndefined();
    expect(callShortcutFor({ key: "m", altKey: true })).toBeUndefined();
  });

  it("does not fire mid-IME-composition", () => {
    // Composing happens inside a field the editable-target check already covers,
    // so this is redundant by construction — and it is what makes "typing
    // Japanese cannot mute the call" a guarantee rather than a consequence.
    expect(callShortcutFor({ key: "m", isComposing: true })).toBeUndefined();
    expect(callShortcutFor({ key: "s", isComposing: true, target: null })).toBeUndefined();
  });

  it("does not fire while the person is typing", () => {
    // The room shows a chat box, shared notes, and a code editor alongside the
    // call controls. Without this, typing "meeting" would mute the call.
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"])
      expect(callShortcutFor({ key: "m", target: element(tag) })).toBeUndefined();
    expect(callShortcutFor({ key: "m", target: element("DIV", true) })).toBeUndefined();
  });

  it("still fires when focus is on a non-editable element", () => {
    expect(callShortcutFor({ key: "m", target: element("BUTTON") })).toBe("toggleMic");
    expect(callShortcutFor({ key: "m", target: element("BODY") })).toBe("toggleMic");
    expect(callShortcutFor({ key: "m", target: null })).toBe("toggleMic");
  });

  it("publishes a display key for every action it can return", () => {
    // Guards against a binding being added without the tooltip and
    // aria-keyshortcuts label that make it discoverable.
    for (const key of ["m", "v", "s"]) {
      const action = callShortcutFor({ key });
      expect(action).toBeDefined();
      expect(shortcutKey[action!]).toMatch(/^[A-Z]$/);
    }
  });
});
