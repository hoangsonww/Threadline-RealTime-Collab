export const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function apiUrl(path: string) {
  if (!apiOrigin)
    throw new ApiError("Threadline API is not configured. Set NEXT_PUBLIC_API_ORIGIN before opening the workspace.");
  return `${apiOrigin}${path}`;
}

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

export type WorkspaceUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  emailVerified: boolean;
};
export type Organization = {
  id: string;
  name: string;
  slug: string;
  allowMemberInvites: boolean;
  role?: "owner" | "admin" | "member";
  attributes?: { canCreateRooms?: boolean; canManageMembers?: boolean; canSchedule?: boolean };
};
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

export type IdentityResponse = { user: WorkspaceUser; organizations: Organization[] };

export function selectedOrganization(identity: IdentityResponse, organizationId?: string | null) {
  return identity.organizations.find((organization) => organization.id === organizationId) ?? identity.organizations[0];
}
