/**
 * Remembers which workspace the user was last looking at.
 *
 * Local storage rather than a server-side preference: it is a per-device UI
 * convenience, not account state, and a person working from two machines
 * reasonably expects each to remember its own place. Nothing here is
 * authoritative — the stored id is validated against actual memberships by
 * `selectedOrganization` in {@link api} before it is used.
 *
 * Neither function can throw. That matters because both are called during
 * render by six org-scoped pages, and a browser configured to refuse site data
 * does not hand back an empty store — it throws on the property access itself.
 * An unremembered workspace has to degrade to the first-organization fallback,
 * not take the authenticated app down with it.
 *
 * @module
 */

/** Local storage key. Namespaced so it cannot collide on a shared origin. */
const KEY = "threadline-last-org";

/**
 * The last selected workspace id, or `null`.
 *
 * Returns `null` during server rendering rather than throwing, so callers do
 * not need their own `typeof window` guard.
 */
export function getPreferredOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Safari with "Block all cookies", and Chromium with site data blocked for
    // the origin, throw a SecurityError from `window.localStorage` before
    // `getItem` is ever reached. Callers treat null as "nothing remembered",
    // which is exactly what a browser that refuses to remember should produce.
    return null;
  }
}

/** Records the active workspace. A no-op during server rendering, and when the browser refuses to store it. */
export function setPreferredOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, orgId);
  } catch {
    // Same refusal as above, plus QuotaExceededError on a full store. Losing the
    // preference costs one fallback on the next visit; throwing here would break
    // the workspace switch that is in progress.
  }
}
