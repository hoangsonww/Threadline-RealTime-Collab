/**
 * The browser's client for `apps/api`.
 *
 * Thin on purpose: one `fetch` wrapper, the response types the UI actually
 * consumes, and a small event bus for identity changes. There is no generated
 * client and no caching layer — the API's shape is documented by its OpenAPI
 * specification, and the components that call it are the right place to decide
 * what to hold on to.
 *
 * @module
 */

/**
 * Where the API lives, from the client's point of view.
 *
 * Often a same-origin path such as `/api/identity` rather than an absolute
 * URL: Next.js rewrites it to the upstream service so that browser traffic
 * stays same-origin, which is what makes secure `HttpOnly` session cookies
 * behave reliably. Being `NEXT_PUBLIC_*`, this value is compiled into the
 * bundle and is public by construction — nothing secret may go here.
 */
export const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "");

/** An API call that did not succeed, carrying the HTTP status where there was one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Resolves a path against {@link apiOrigin}.
 *
 * Throws rather than falling back to a relative URL when the origin is
 * unconfigured: a silent fallback produces requests to the Next.js server that
 * 404 in a way that looks like an API bug rather than a missing environment
 * variable.
 *
 * @throws {@link ApiError} if `NEXT_PUBLIC_API_ORIGIN` is not set.
 */
export function apiUrl(path: string) {
  if (!apiOrigin)
    throw new ApiError("Threadline API is not configured. Set NEXT_PUBLIC_API_ORIGIN before opening the workspace.");
  return `${apiOrigin}${path}`;
}

/**
 * Performs an API request and returns its parsed body.
 *
 * - `credentials: "include"` so the session cookie travels with it.
 * - `content-type: application/json` is set only when there is a body, so a
 *   GET does not advertise a payload it does not have.
 * - 204 resolves to `undefined` rather than failing to parse an empty body.
 * - A non-2xx response throws {@link ApiError} carrying the server's own
 *   message where it supplied one.
 *
 * @typeParam T - The expected response shape. Not validated at runtime; the
 * API's contract is enforced on the server, and re-validating every response in
 * the client would duplicate the OpenAPI schema in a second place that goes
 * stale.
 * @throws {@link ApiError} on any non-2xx response.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { message?: string } & T;
  if (!response.ok) throw new ApiError(data.message ?? "The request could not be completed.", response.status);
  return data;
}

/** The signed-in user, as `/v1/auth/me` returns them. */
export type WorkspaceUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  emailVerified: boolean;
  createdAt?: string;
};
/**
 * A workspace the signed-in user belongs to.
 *
 * `role` and `attributes` are present so the UI can hide actions the user
 * cannot take. They are a *presentation* concern only — the server decides
 * again on every request, and hiding a button is not an access control.
 */
export type Organization = {
  id: string;
  name: string;
  slug: string;
  allowMemberInvites: boolean;
  role?: "owner" | "admin" | "member";
  attributes?: { canCreateRooms?: boolean; canManageMembers?: boolean; canSchedule?: boolean };
};
/** A room, as the directory and workspace views consume it. */
export type Room = {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  visibility?: "organization" | "restricted";
  classification?: "internal" | "confidential";
  createdAt: string;
  updatedAt: string;
};

/** The bootstrap payload every authenticated surface loads on mount. */
export type IdentityResponse = { user: WorkspaceUser; organizations: Organization[] };

/**
 * Resolves the active workspace, falling back to the first one.
 *
 * A stored organization id can outlive the membership that made it valid — a
 * user removed from a workspace still has its id in local storage — so an
 * unmatched id must degrade to a workspace they *do* belong to rather than to
 * `undefined`.
 */
export function selectedOrganization(identity: IdentityResponse, organizationId?: string | null) {
  return identity.organizations.find((organization) => organization.id === organizationId) ?? identity.organizations[0];
}

/**
 * Broadcast that the signed-in user's own identity changed.
 *
 * Every surface that shows a name or avatar reads /v1/auth/me once when it
 * mounts, so a rename on the profile page would otherwise leave the topbar
 * showing the previous name until a full reload — the one change a person is
 * guaranteed to be looking for right after they make it.
 */
const identityUpdatedEvent = "threadline:identity-updated";

/** Fires the identity-changed event. Call after any mutation of the signed-in user. */
export function announceIdentityUpdate() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(identityUpdatedEvent));
}

/**
 * Subscribes to identity changes.
 *
 * Returns an unsubscribe function, and is safe to call during server rendering
 * — where there is no `window`, it returns a no-op rather than throwing.
 */
export function onIdentityUpdate(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(identityUpdatedEvent, listener);
  return () => window.removeEventListener(identityUpdatedEvent, listener);
}
