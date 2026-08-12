import type { Membership, Organization, Room, RoomMembership, RoomRole } from "./domain.js";

export type OrganizationAction = "read" | "create_room" | "manage_members" | "schedule";
export type RoomAction = "read" | "join_live" | "write" | "manage";

/**
 * The policy is intentionally attribute based: a decision considers the user’s
 * organization role, explicitly delegated membership attributes, resource
 * visibility/classification, and a room-specific role. Routes never infer
 * access from an id alone.
 */
export function canOrganization(membership: Membership | undefined, action: OrganizationAction) {
  if (!membership) return false;
  if (action === "read") return true;
  if (action === "create_room")
    return membership.role === "owner" || membership.role === "admin" || membership.attributes?.canCreateRooms === true;
  if (action === "manage_members")
    return (
      membership.role === "owner" || membership.role === "admin" || membership.attributes?.canManageMembers === true
    );
  return membership.role === "owner" || membership.role === "admin" || membership.attributes?.canSchedule === true;
}

/**
 * Who may view or regenerate an organization's join code. Owners and admins
 * always can; a plain member can only when the organization has explicitly
 * opted in via `allowMemberInvites` — that flag is what "share access" means
 * for a role with no other management power.
 */
export function canInviteToOrganization(membership: Membership | undefined, organization: Organization) {
  if (!membership) return false;
  if (membership.role === "owner" || membership.role === "admin") return true;
  return organization.allowMemberInvites === true;
}

export function effectiveRoomRole(
  membership: Membership | undefined,
  room: Room,
  roomMembership: RoomMembership | undefined,
): RoomRole | undefined {
  if (!membership) return undefined;
  if (roomMembership) return roomMembership.role;
  // Organization administrators can intervene in any room. Other members can
  // use only organization-visible rooms.
  if (membership.role === "owner" || membership.role === "admin") return "host";
  // Existing Atlas rooms created before access attributes were introduced
  // remain organization-visible. Confidential rooms still require explicit
  // room membership unless the caller is an organization administrator.
  return (room.visibility ?? "organization") === "organization" &&
    (room.classification ?? "internal") !== "confidential"
    ? "member"
    : undefined;
}

export function canRoom(
  membership: Membership | undefined,
  room: Room,
  roomMembership: RoomMembership | undefined,
  action: RoomAction,
) {
  const role = effectiveRoomRole(membership, room, roomMembership);
  if (!role) return false;
  if (action === "read" || action === "join_live") return true;
  if (action === "write") return role !== "viewer";
  return (
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    membership?.attributes?.canManageMembers === true ||
    roomMembership?.role === "owner"
  );
}
