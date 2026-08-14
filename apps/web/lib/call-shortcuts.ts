/**
 * Keyboard shortcuts for the live call controls.
 *
 * Kept as a pure function over the parts of a KeyboardEvent that matter, so the
 * rules can be tested without a DOM and without mounting the room. The room
 * component only has to decide what to do with the result.
 */

export type CallShortcut = "toggleMic" | "toggleCamera" | "toggleScreenShare";

const bindings: Record<string, CallShortcut> = {
  m: "toggleMic",
  v: "toggleCamera",
  s: "toggleScreenShare",
};

/** Human-readable key for each action, for tooltips and `aria-keyshortcuts`. */
export const shortcutKey: Record<CallShortcut, string> = {
  toggleMic: "M",
  toggleCamera: "V",
  toggleScreenShare: "S",
};

type ShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True mid-IME-composition, when the keystroke belongs to the input method. */
  isComposing?: boolean;
  /** Where the keystroke landed. Anything text-editable is left alone. */
  target?: EventTarget | null;
};

/**
 * True when the keystroke belongs to whatever the person is typing into.
 *
 * This is the whole reason the feature needs care: the room has a chat box, a
 * shared notes editor, and a code editor on screen at the same time as the call
 * controls. A bare `m` handler on the window would mute the call every time
 * someone typed the word "meeting".
 */
const isEditingTarget = (target: EventTarget | null | undefined) => {
  if (!target || typeof target !== "object" || !("tagName" in target)) return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
};

export function callShortcutFor(event: ShortcutEvent): CallShortcut | undefined {
  // A modified key is a browser or OS command (⌘S, Ctrl+V, …). Claiming those
  // would break saving a page or pasting, for a feature nobody asked to have
  // priority over either.
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  // Composing with an IME always happens inside a field the check below already
  // covers, so this is belt and braces — but it is the guarantee that someone
  // typing Japanese or Korean cannot mute a call mid-word, and it costs one line.
  if (event.isComposing) return undefined;
  if (isEditingTarget(event.target)) return undefined;
  if (event.key.length !== 1) return undefined;
  return bindings[event.key.toLowerCase()];
}
