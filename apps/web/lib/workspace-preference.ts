/**
 * Remembers which workspace the user was last looking at.
 *
 * Local storage rather than a server-side preference: it is a per-device UI
 * convenience, not account state, and a person working from two machines
 * reasonably expects each to remember its own place. Nothing here is
 * authoritative — the stored id is validated against actual memberships by
 * `selectedOrganization` in {@link api} before it is used.
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
  return window.localStorage.getItem(KEY);
}

/** Records the active workspace. A no-op during server rendering. */
export function setPreferredOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, orgId);
}
